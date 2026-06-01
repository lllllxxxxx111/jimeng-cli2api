import { PrismaClient } from '@prisma/client';
import { runJimengCommand, runJimengCommandInSwap, withCredSwap } from '../utils/cliRunner';

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

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  }));
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

function parseMaybeJson(value: any): any {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function collectUrls(value: any, out: string[] = [], seen = new Set<any>(), depth = 0): string[] {
  if (value === null || value === undefined || depth > 10) return out;

  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s"'<>\\]+/g);
    if (matches) out.push(...matches);
    return out;
  }

  if (typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out, seen, depth + 1);
    return out;
  }

  for (const item of Object.values(value)) {
    collectUrls(item, out, seen, depth + 1);
  }
  return out;
}

function isImageTask(taskType: string): boolean {
  return taskType === 'image2image' || taskType === 'text2image' || taskType === 'image_upscale';
}

function extractFinalUrl(item: any, taskType: string): string | null {
  const resultJson = parseMaybeJson(item.result_json);
  const searchableItem = { ...item, request: undefined, result_json: resultJson };
  const urls = [
    ...collectUrls(resultJson),
    ...collectUrls(item.result),
    ...collectUrls(item.data),
    ...collectUrls(item.item_list),
    ...collectUrls(searchableItem),
  ];

  const uniqueUrls = Array.from(new Set(urls));
  if (uniqueUrls.length === 0) return null;

  const image = isImageTask(taskType);
  const mediaPattern = image
    ? /\.(png|jpe?g|webp|gif|bmp|tiff?)(?:[?&#]|$)/i
    : /\.(mp4|mov|m4v|webm|m3u8)(?:[?&#]|$)/i;

  return uniqueUrls.find(url => mediaPattern.test(url))
    || uniqueUrls.find(url => image ? /image/i.test(url) : /video/i.test(url))
    || uniqueUrls[0];
}

function numberOrNull(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function intOrNull(value: any): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed);
}

function progressOrNull(value: any): number | null {
  const parsed = numberOrNull(value);
  if (parsed === null) return null;
  const percent = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function textOrNull(value: any): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function safeJsonStringify(value: any, maxLength = 10000): string | null {
  try {
    const text = JSON.stringify(value);
    if (!text) return null;
    if (text.length <= maxLength) return text;
    return JSON.stringify({ truncated: true, preview: text.slice(0, maxLength) });
  } catch {
    return null;
  }
}

function findDeep(value: any, keys: string[], seen = new Set<any>(), depth = 0): any {
  if (value === null || value === undefined || depth > 8) return undefined;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const parsed = parseMaybeJson(value);
  if (parsed !== value) return findDeep(parsed, keys, seen, depth + 1);

  if (!Array.isArray(value)) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        return parseMaybeJson(value[key]);
      }
    }
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findDeep(child, keys, seen, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractQueueState(item: any, rawStatus: string) {
  const queueInfo = findDeep(item, ['queue_info', 'queueInfo', 'queue']);
  const queueSource = queueInfo && typeof queueInfo === 'object' ? queueInfo : {};
  const queueStatus = textOrNull(
    (queueSource as any).queue_status
      ?? (queueSource as any).queueStatus
      ?? (queueSource as any).status
      ?? (queueSource as any).state
      ?? findDeep(item, ['queue_status', 'queueStatus', 'queue_state', 'queueState'])
      ?? (rawStatus || null)
  );
  const queueIndex = intOrNull(
    (queueSource as any).queue_idx
      ?? (queueSource as any).queueIndex
      ?? (queueSource as any).queue_index
      ?? (queueSource as any).index
      ?? (queueSource as any).position
      ?? findDeep(item, ['queue_idx', 'queueIndex', 'queue_index', 'queue_position', 'position'])
  );
  const queueLength = intOrNull(
    (queueSource as any).queue_length
      ?? (queueSource as any).queueLength
      ?? (queueSource as any).queue_size
      ?? (queueSource as any).length
      ?? (queueSource as any).total
      ?? findDeep(item, ['queue_length', 'queueLength', 'queue_size', 'queue_total', 'total'])
  );
  const queueWaitSeconds = intOrNull(
    (queueSource as any).wait_seconds
      ?? (queueSource as any).waitSeconds
      ?? (queueSource as any).wait_time
      ?? (queueSource as any).waitTime
      ?? (queueSource as any).eta
      ?? findDeep(item, ['wait_seconds', 'waitSeconds', 'wait_time', 'waitTime', 'eta'])
  );
  const progressPercent = progressOrNull(
    findDeep(item, ['progress_percent', 'progressPercent', 'percent', 'progress', 'gen_progress'])
  );

  return {
    queueStatus,
    queueIndex,
    queueLength,
    queueWaitSeconds,
    progressPercent,
    liveStatusRaw: safeJsonStringify(item),
    lastPolledAt: new Date(),
  };
}

function normalizeTaskState(payload: any, taskType: string) {
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item || typeof item !== 'object') return null;

  const rawStatus = String(item.gen_status ?? item.status ?? item.task_status ?? item.task?.status ?? '').toLowerCase();
  const isProcessing = ['pending', 'processing', 'running', 'queueing', 'queued', 'submitted', 'querying'].includes(rawStatus);
  const isFailed = ['failed', 'fail', 'error'].includes(rawStatus) || item.status === 2 || item.task?.status === 2;

  const finalUrl = extractFinalUrl(item, taskType);
  const queue = extractQueueState(item, rawStatus);

  return { rawStatus, isProcessing, isFailed, finalUrl, item, ...queue };
}

function taskStateData(state: any, overrides: Record<string, any> = {}) {
  return {
    queueStatus: state.queueStatus,
    queueIndex: state.queueIndex,
    queueLength: state.queueLength,
    queueWaitSeconds: state.queueWaitSeconds,
    progressPercent: state.progressPercent,
    liveStatusRaw: state.liveStatusRaw,
    lastPolledAt: state.lastPolledAt,
    ...overrides,
  };
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
        // ── 24h 超时：提交超过 24h 仍 PROCESSING 的任务直接标 FAILED ──
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const timedOut = await prisma.task.findMany({
          where: { status: 'PROCESSING', createdAt: { lt: cutoff } }
        });
        for (const t of timedOut) {
          console.warn(`[Daemon] Task ${t.id} timed out (>24h). Marking FAILED.`);
          await prisma.task.update({
            where: { id: t.id },
            data: {
              status: 'FAILED',
              errorMsg: '任务超过24小时未完成，已自动标记为失败。',
              pollErrorMsg: null,
              queueStatus: 'timeout',
              progressPercent: null,
              lastPolledAt: new Date(),
            }
          });
        }

        const tasks = await prisma.task.findMany({
          where: { status: 'PROCESSING', jimengSubmitId: { not: null } },
          include: { account: true }
        });

        if (tasks.length === 0) { scheduleNext(); return; }

        const batchSize = getAdaptiveConcurrency(tasks.length);
        console.log(`[Daemon] Polling ${tasks.length} tasks, concurrency=${batchSize}, networkErrors=${consecutiveNetworkErrors}`);

        // Windows: 将所有任务按账号分组，每个账号只做一次注册表 swap，
        //          同账号内的多条查询在同一次 swap 内并发执行。
        // Unix:    withCredSwap 直接透传（无 mutex），所有任务真正并发。
        type TaskWithAccount = typeof tasks[0];
        const byAccount = new Map<string, TaskWithAccount[]>();
        for (const task of tasks) {
          const key = task.accountId ?? '__none__';
          if (!byAccount.has(key)) byAccount.set(key, []);
          byAccount.get(key)!.push(task);
        }

        // 账号间顺序迭代（释放 mutex 间隙给新提交），账号内任务并发执行。
        // Windows: Promise.all(accounts) 会让所有账号同时入队 mutex 形成连续块，
        //          新提交无法插入；改为 for...of 后，每个账号释放锁后
        //          新提交可以在账号间隙中抢到 mutex，避免饥饿。
        // Unix:    withCredSwap 无 mutex，顺序 vs 并发性能相同。
        for (const [, accountTasks] of byAccount.entries()) {
          const homeDir = (accountTasks[0] as any).account?.homeDir || process.cwd();
          await withCredSwap(homeDir, async () => {
            // 同账号任务：锁内并发执行（不再各自 re-acquire mutex）
            await runWithConcurrency(accountTasks, batchSize, async (task) => {
              if (!task.jimengSubmitId) return;
              const t0 = Date.now();
              let stdout = '';
              let isNetworkError = false;
              try {
                const result = await runJimengCommandInSwap(
                  `dreamina query_result --submit_id=${task.jimengSubmitId}`, homeDir
                );
                stdout = result.stdout;
                recordResponseTime(Date.now() - t0);
              } catch (queryErr: any) {
                recordResponseTime(TARGET_BATCH_MS);
                try {
                  const t1 = Date.now();
                  const result = await runJimengCommandInSwap(
                    `dreamina list_task --submit_id=${task.jimengSubmitId} --limit=1`, homeDir
                  );
                  stdout = result.stdout;
                  recordResponseTime(Date.now() - t1);
                } catch (fallbackErr: any) {
                  isNetworkError = true;
                  const errMsg = String(fallbackErr?.message || queryErr?.message || '未知网络错误');
                  consecutiveNetworkErrors++;
                  console.warn(`[Daemon] Network error for task ${task.id} (globalNetErr=${consecutiveNetworkErrors}): ${errMsg}`);
                  await prisma.task.update({
                    where: { id: task.id },
                    data: {
                      lastPolledAt: new Date(),
                      pollErrorMsg: `[${new Date().toISOString()}] 我方网络异常，轮询暂时中断，任务仍在火山排队。错误: ${errMsg.substring(0, 200)}`
                    }
                  });
                  return;
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
                data: {
                  lastPolledAt: new Date(),
                  pollErrorMsg: `[${new Date().toISOString()}] 响应解析失败，将自动重试。Raw: ${stdout.substring(0, 200)}`
                }
              });
              return;
            }

            // ── 3. 根据火山明确状态更新任务 ───────────────────────
            if (state.finalUrl) {
              // 火山明确：成功
              console.log(`[Daemon] Task ${task.id} SUCCESS. URL: ${state.finalUrl}`);
              await prisma.task.update({
                where: { id: task.id },
                data: taskStateData(state, {
                  status: 'SUCCESS',
                  resultUrl: state.finalUrl,
                  pollErrorMsg: null,
                  queueStatus: state.queueStatus || 'completed',
                  progressPercent: 100,
                })
              });
            } else if (state.isFailed) {
              // 火山明确：失败（gen_status = failed/fail/error，或 status=2）
              const failReason = state.item.fail_reason || state.item.error_msg || state.item.message || null;
              console.log(`[Daemon] Task ${task.id} FAILED by Volcengine. rawStatus=${state.rawStatus}, reason=${failReason}`);
              await prisma.task.update({
                where: { id: task.id },
                data: taskStateData(state, {
                  status: 'FAILED',
                  errorMsg: failReason || `火山服务返回失败。状态: ${state.rawStatus}. 原始: ${stdout.substring(0, 200)}`,
                  pollErrorMsg: null,
                  queueStatus: state.queueStatus || 'failed',
                })
              });
            } else if (state.isProcessing) {
              // 火山明确：还在处理，继续等
              const queueLog = [
                state.queueStatus ? `queueStatus=${state.queueStatus}` : '',
                state.queueIndex !== null && state.queueIndex !== undefined ? `queueIndex=${state.queueIndex}` : '',
                state.queueLength !== null && state.queueLength !== undefined ? `queueLength=${state.queueLength}` : '',
                state.progressPercent !== null && state.progressPercent !== undefined ? `progress=${state.progressPercent}%` : '',
              ].filter(Boolean).join(', ');
              console.log(`[Daemon] Task ${task.id} still processing on Volcengine (rawStatus=${state.rawStatus}${queueLog ? `, ${queueLog}` : ''}).`);
              await prisma.task.update({
                where: { id: task.id },
                data: taskStateData(state, {
                  pollErrorMsg: null,
                  queueStatus: state.queueStatus || state.rawStatus || 'processing',
                })
              });
            } else {
              // 状态未知但 CLI 正常返回 → 保守处理，继续等
              console.warn(`[Daemon] Task ${task.id} unknown rawStatus="${state.rawStatus}", keeping PROCESSING.`);
              await prisma.task.update({
                where: { id: task.id },
                data: taskStateData(state, {
                  pollErrorMsg: `[${new Date().toISOString()}] 未知状态"${state.rawStatus}"，保持等待。`,
                  queueStatus: state.queueStatus || state.rawStatus || 'unknown',
                })
              });
            }
          });  // end runWithConcurrency(accountTasks)
          });    // end withCredSwap callback
        }          // end for...of byAccount
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
