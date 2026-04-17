import { PrismaClient } from '@prisma/client';
import { runJimengCommand } from '../utils/cliRunner';

const prisma = new PrismaClient();

// ── 全局网络健康状态 ──────────────────────────────────────────────
// 只追踪"我们这边"的网络问题（CLI 调用超时/连接失败等）
// 与任务本身是否成功完全隔离

let consecutiveNetworkErrors = 0;   // 连续网络失败次数（任意任务失败+1，任意任务成功清零）
let isPolling = false;
let currentInterval = 30000;        // 当前轮询间隔，会随网络状态动态调整

const INTERVAL_NORMAL  = 30_000;   //  30s - 网络正常
const INTERVAL_WARN    = 60_000;   //  60s - 轻微抖动（连续失败 3+）
const INTERVAL_DEGRADE = 120_000;  // 120s - 明显波动（连续失败 6+）
const INTERVAL_DOWN    = 300_000;  //  300s - 网络基本断开（连续失败 10+）

function getIntervalByHealth(): number {
  if (consecutiveNetworkErrors >= 10) return INTERVAL_DOWN;
  if (consecutiveNetworkErrors >= 6)  return INTERVAL_DEGRADE;
  if (consecutiveNetworkErrors >= 3)  return INTERVAL_WARN;
  return INTERVAL_NORMAL;
}

// ── 响应时间自适应并发 ────────────────────────────────────────────
const recentResponseTimes: number[] = [];
const RESPONSE_SAMPLE_SIZE = 20;
const TARGET_BATCH_MS = 10000;
const MIN_CONCURRENCY = 2;
const MAX_CONCURRENCY = 20;

function recordResponseTime(ms: number) {
  recentResponseTimes.push(ms);
  if (recentResponseTimes.length > RESPONSE_SAMPLE_SIZE) recentResponseTimes.shift();
}

function getAdaptiveConcurrency(taskCount: number): number {
  if (recentResponseTimes.length < 5) {
    return Math.min(4, taskCount);
  }
  const sorted = [...recentResponseTimes].sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const estimated = Math.floor(TARGET_BATCH_MS / p75);
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, estimated, taskCount));
}
// ─────────────────────────────────────────────────────────────────

function extractJsonPayload(stdout: string): any | null {
  const arrayMatch = stdout.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }

  const objectMatch = stdout.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }

  return null;
}

function normalizeTaskState(payload: any, taskType: string) {
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item || typeof item !== 'object') return null;

  const rawStatus = String(item.gen_status ?? item.status ?? item.task_status ?? '').toLowerCase();
  const isProcessing = ['pending', 'processing', 'running', 'queueing', 'queued', 'submitted'].includes(rawStatus);
  const isFailed = ['failed', 'fail', 'error'].includes(rawStatus) || item.status === 2;

  let finalUrl = null;
  if (taskType === 'image2image' || taskType === 'text2image' || taskType === 'image_upscale') {
    finalUrl = item.result_json?.images?.[0]?.image_url
      || item.result_json?.images?.[0]?.url
      || item.result?.images?.[0]?.image_url
      || item.image_url
      || item.url;
  } else {
    finalUrl = item.result_json?.videos?.[0]?.video_url
      || item.result_json?.videos?.[0]?.url
      || item.result?.videos?.[0]?.video_url
      || item.video_url
      || item.url;
  }

  return { rawStatus, isProcessing, isFailed, finalUrl, item };
}

export const pollingDaemon = {
  start() {
    console.log('[🔄] Polling Daemon started.');

    const scheduleNext = () => {
      const interval = getIntervalByHealth();
      if (interval !== currentInterval) {
        currentInterval = interval;
        console.log(`[Daemon] Network health changed. Next poll in ${interval / 1000}s (consecutiveNetworkErrors=${consecutiveNetworkErrors})`);
      }
      setTimeout(runPoll, interval);
    };

    const runPoll = async () => {
      if (isPolling) { scheduleNext(); return; }
      isPolling = true;

      try {
        const tasks = await prisma.task.findMany({
          where: { status: 'PROCESSING', jimengSubmitId: { not: null } },
          include: { account: true }
        });

        if (tasks.length === 0) { scheduleNext(); return; }

        const batchSize = getAdaptiveConcurrency(tasks.length);
        console.log(`[Daemon] Polling ${tasks.length} tasks, concurrency=${batchSize}, networkErrors=${consecutiveNetworkErrors}`);

        for (let i = 0; i < tasks.length; i += batchSize) {
          const batch = tasks.slice(i, i + batchSize);
          await Promise.all(batch.map(async (task) => {
            if (!task.jimengSubmitId) return;

            const homeDir = (task as any).account?.homeDir || process.cwd();
            const t0 = Date.now();

            let stdout = '';
            let isNetworkError = false;

            // ── 1. 调用 CLI 查询 ──────────────────────────────────
            try {
              const result = await runJimengCommand(
                `dreamina query_result --submit_id=${task.jimengSubmitId}`, homeDir
              );
              stdout = result.stdout;
              recordResponseTime(Date.now() - t0);
            } catch (queryErr: any) {
              recordResponseTime(TARGET_BATCH_MS); // 失败记为慢请求，压低并发
              try {
                // fallback: list_task
                const t1 = Date.now();
                const result = await runJimengCommand(
                  `dreamina list_task --submit_id=${task.jimengSubmitId} --limit=1`, homeDir
                );
                stdout = result.stdout;
                recordResponseTime(Date.now() - t1);
              } catch (fallbackErr: any) {
                // 两个命令都失败 → 网络问题，不动任务状态
                isNetworkError = true;
                const errMsg = String(fallbackErr?.message || queryErr?.message || '未知网络错误');
                consecutiveNetworkErrors++;
                console.warn(`[Daemon] Network error for task ${task.id} (globalNetErr=${consecutiveNetworkErrors}): ${errMsg}`);
                await prisma.task.update({
                  where: { id: task.id },
                  data: {
                    pollErrorMsg: `[${new Date().toISOString()}] 我方网络异常，轮询暂时中断，任务仍在火山排队。错误: ${errMsg.substring(0, 200)}`
                  }
                });
                return; // 不处理状态，等下次轮询
              }
            }

            // ── 2. 解析火山的回复 ─────────────────────────────────
            // 到这里说明 CLI 调用成功了，网络恢复
            if (!isNetworkError) {
              consecutiveNetworkErrors = Math.max(0, consecutiveNetworkErrors - 1); // 逐渐恢复
            }

            const payload = extractJsonPayload(stdout);
            const state = normalizeTaskState(payload, task.type);

            if (!state) {
              // CLI 返回了但无法解析 → 也是我方问题（格式异常），不判定任务失败
              consecutiveNetworkErrors++;
              console.warn(`[Daemon] Cannot parse response for task ${task.id}. Raw: ${stdout.substring(0, 200)}`);
              await prisma.task.update({
                where: { id: task.id },
                data: { pollErrorMsg: `[${new Date().toISOString()}] 响应解析失败，将自动重试。Raw: ${stdout.substring(0, 200)}` }
              });
              return;
            }

            // ── 3. 根据火山明确状态更新任务 ───────────────────────
            if (state.finalUrl) {
              // 火山明确：成功
              console.log(`[Daemon] Task ${task.id} SUCCESS. URL: ${state.finalUrl}`);
              await prisma.task.update({
                where: { id: task.id },
                data: { status: 'SUCCESS', resultUrl: state.finalUrl, pollErrorMsg: null }
              });
            } else if (state.isFailed) {
              // 火山明确：失败（gen_status = failed/fail/error，或 status=2）
              console.log(`[Daemon] Task ${task.id} FAILED by Volcengine. rawStatus=${state.rawStatus}`);
              await prisma.task.update({
                where: { id: task.id },
                data: {
                  status: 'FAILED',
                  errorMsg: `火山服务返回失败。状态: ${state.rawStatus}. 原始: ${stdout.substring(0, 200)}`,
                  pollErrorMsg: null
                }
              });
            } else if (state.isProcessing) {
              // 火山明确：还在处理，继续等
              console.log(`[Daemon] Task ${task.id} still processing on Volcengine (rawStatus=${state.rawStatus}).`);
              // 如果之前有 pollErrorMsg（网络恢复了），清掉它
              if ((task as any).pollErrorMsg) {
                await prisma.task.update({ where: { id: task.id }, data: { pollErrorMsg: null } });
              }
            } else {
              // 状态未知但 CLI 正常返回 → 保守处理，继续等
              console.warn(`[Daemon] Task ${task.id} unknown rawStatus="${state.rawStatus}", keeping PROCESSING.`);
              await prisma.task.update({
                where: { id: task.id },
                data: { pollErrorMsg: `[${new Date().toISOString()}] 未知状态"${state.rawStatus}"，保持等待。` }
              });
            }
          }));
        }
      } catch (err) {
        console.error('[Daemon] Fatal error in polling loop:', err);
      } finally {
        isPolling = false;
        scheduleNext();
      }
    };

    // 首次启动延迟 5s，等服务完全就绪
    setTimeout(runPoll, 5000);
  }
};
