"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollingDaemon = void 0;
const client_1 = require("@prisma/client");
const cliRunner_1 = require("../utils/cliRunner");
const prisma = new client_1.PrismaClient();
// ── 全局网络健康状态 ──────────────────────────────────────────────
// 只追踪"我们这边"的网络问题（CLI 调用超时/连接失败等）
// 与任务本身是否成功完全隔离
let consecutiveNetworkErrors = 0; // 连续网络失败次数（任意任务失败+1，任意任务成功清零）
let isPolling = false;
let currentInterval = 30000; // 当前轮询间隔，会随网络状态动态调整
const INTERVAL_NORMAL = 30_000; //  30s - 网络正常
const INTERVAL_WARN = 60_000; //  60s - 轻微抖动（连续失败 3+）
const INTERVAL_DEGRADE = 120_000; // 120s - 明显波动（连续失败 6+）
const INTERVAL_DOWN = 300_000; //  300s - 网络基本断开（连续失败 10+）
function getIntervalByHealth() {
    if (consecutiveNetworkErrors >= 10)
        return INTERVAL_DOWN;
    if (consecutiveNetworkErrors >= 6)
        return INTERVAL_DEGRADE;
    if (consecutiveNetworkErrors >= 3)
        return INTERVAL_WARN;
    return INTERVAL_NORMAL;
}
// ── 响应时间自适应并发 ────────────────────────────────────────────
const recentResponseTimes = [];
const RESPONSE_SAMPLE_SIZE = 20;
const TARGET_BATCH_MS = 10000;
const MIN_CONCURRENCY = 2;
const MAX_CONCURRENCY = 20;
function recordResponseTime(ms) {
    recentResponseTimes.push(ms);
    if (recentResponseTimes.length > RESPONSE_SAMPLE_SIZE)
        recentResponseTimes.shift();
}
function getAdaptiveConcurrency(taskCount) {
    if (recentResponseTimes.length < 5) {
        return Math.min(4, taskCount);
    }
    const sorted = [...recentResponseTimes].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const estimated = Math.floor(TARGET_BATCH_MS / p75);
    return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, estimated, taskCount));
}
async function runWithConcurrency(items, limit, worker) {
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length)
                return;
            await worker(items[index]);
        }
    }));
}
// ─────────────────────────────────────────────────────────────────
function extractJsonPayload(stdout) {
    const arrayMatch = stdout.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            return JSON.parse(arrayMatch[0]);
        }
        catch { }
    }
    const objectMatch = stdout.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        }
        catch { }
    }
    return null;
}
function parseMaybeJson(value) {
    if (typeof value !== 'string')
        return value;
    const text = value.trim();
    if (!text || (text[0] !== '{' && text[0] !== '['))
        return value;
    try {
        return JSON.parse(text);
    }
    catch {
        return value;
    }
}
function collectUrls(value, out = [], seen = new Set(), depth = 0) {
    if (value === null || value === undefined || depth > 10)
        return out;
    if (typeof value === 'string') {
        const matches = value.match(/https?:\/\/[^\s"'<>\\]+/g);
        if (matches)
            out.push(...matches);
        return out;
    }
    if (typeof value !== 'object')
        return out;
    if (seen.has(value))
        return out;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value)
            collectUrls(item, out, seen, depth + 1);
        return out;
    }
    for (const item of Object.values(value)) {
        collectUrls(item, out, seen, depth + 1);
    }
    return out;
}
function isImageTask(taskType) {
    return taskType === 'image2image' || taskType === 'text2image' || taskType === 'image_upscale';
}
function extractFinalUrl(item, taskType) {
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
    if (uniqueUrls.length === 0)
        return null;
    const image = isImageTask(taskType);
    const mediaPattern = image
        ? /\.(png|jpe?g|webp|gif|bmp|tiff?)(?:[?&#]|$)/i
        : /\.(mp4|mov|m4v|webm|m3u8)(?:[?&#]|$)/i;
    return uniqueUrls.find(url => mediaPattern.test(url))
        || uniqueUrls.find(url => image ? /image/i.test(url) : /video/i.test(url))
        || uniqueUrls[0];
}
function normalizeTaskState(payload, taskType) {
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (!item || typeof item !== 'object')
        return null;
    const rawStatus = String(item.gen_status ?? item.status ?? item.task_status ?? item.task?.status ?? '').toLowerCase();
    const isProcessing = ['pending', 'processing', 'running', 'queueing', 'queued', 'submitted', 'querying'].includes(rawStatus);
    const isFailed = ['failed', 'fail', 'error'].includes(rawStatus) || item.status === 2 || item.task?.status === 2;
    const finalUrl = extractFinalUrl(item, taskType);
    return { rawStatus, isProcessing, isFailed, finalUrl, item };
}
exports.pollingDaemon = {
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
            if (isPolling) {
                scheduleNext();
                return;
            }
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
                        data: { status: 'FAILED', errorMsg: '任务超过24小时未完成，已自动标记为失败。', pollErrorMsg: null }
                    });
                }
                const tasks = await prisma.task.findMany({
                    where: { status: 'PROCESSING', jimengSubmitId: { not: null } },
                    include: { account: true }
                });
                if (tasks.length === 0) {
                    scheduleNext();
                    return;
                }
                const batchSize = getAdaptiveConcurrency(tasks.length);
                console.log(`[Daemon] Polling ${tasks.length} tasks, concurrency=${batchSize}, networkErrors=${consecutiveNetworkErrors}`);
                const byAccount = new Map();
                for (const task of tasks) {
                    const key = task.accountId ?? '__none__';
                    if (!byAccount.has(key))
                        byAccount.set(key, []);
                    byAccount.get(key).push(task);
                }
                // 账号间顺序迭代（释放 mutex 间隙给新提交），账号内任务并发执行。
                // Windows: Promise.all(accounts) 会让所有账号同时入队 mutex 形成连续块，
                //          新提交无法插入；改为 for...of 后，每个账号释放锁后
                //          新提交可以在账号间隙中抢到 mutex，避免饥饿。
                // Unix:    withCredSwap 无 mutex，顺序 vs 并发性能相同。
                for (const [, accountTasks] of byAccount.entries()) {
                    const homeDir = accountTasks[0].account?.homeDir || process.cwd();
                    await (0, cliRunner_1.withCredSwap)(homeDir, async () => {
                        // 同账号任务：锁内并发执行（不再各自 re-acquire mutex）
                        await runWithConcurrency(accountTasks, batchSize, async (task) => {
                            if (!task.jimengSubmitId)
                                return;
                            const t0 = Date.now();
                            let stdout = '';
                            let isNetworkError = false;
                            try {
                                const result = await (0, cliRunner_1.runJimengCommandInSwap)(`dreamina query_result --submit_id=${task.jimengSubmitId}`, homeDir);
                                stdout = result.stdout;
                                recordResponseTime(Date.now() - t0);
                            }
                            catch (queryErr) {
                                recordResponseTime(TARGET_BATCH_MS);
                                try {
                                    const t1 = Date.now();
                                    const result = await (0, cliRunner_1.runJimengCommandInSwap)(`dreamina list_task --submit_id=${task.jimengSubmitId} --limit=1`, homeDir);
                                    stdout = result.stdout;
                                    recordResponseTime(Date.now() - t1);
                                }
                                catch (fallbackErr) {
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
                            }
                            else if (state.isFailed) {
                                // 火山明确：失败（gen_status = failed/fail/error，或 status=2）
                                const failReason = state.item.fail_reason || state.item.error_msg || state.item.message || null;
                                console.log(`[Daemon] Task ${task.id} FAILED by Volcengine. rawStatus=${state.rawStatus}, reason=${failReason}`);
                                await prisma.task.update({
                                    where: { id: task.id },
                                    data: {
                                        status: 'FAILED',
                                        errorMsg: failReason || `火山服务返回失败。状态: ${state.rawStatus}. 原始: ${stdout.substring(0, 200)}`,
                                        pollErrorMsg: null
                                    }
                                });
                            }
                            else if (state.isProcessing) {
                                // 火山明确：还在处理，继续等
                                console.log(`[Daemon] Task ${task.id} still processing on Volcengine (rawStatus=${state.rawStatus}).`);
                                // 如果之前有 pollErrorMsg（网络恢复了），清掉它
                                if (task.pollErrorMsg) {
                                    await prisma.task.update({ where: { id: task.id }, data: { pollErrorMsg: null } });
                                }
                            }
                            else {
                                // 状态未知但 CLI 正常返回 → 保守处理，继续等
                                console.warn(`[Daemon] Task ${task.id} unknown rawStatus="${state.rawStatus}", keeping PROCESSING.`);
                                await prisma.task.update({
                                    where: { id: task.id },
                                    data: { pollErrorMsg: `[${new Date().toISOString()}] 未知状态"${state.rawStatus}"，保持等待。` }
                                });
                            }
                        }); // end runWithConcurrency(accountTasks)
                    }); // end withCredSwap callback
                } // end for...of byAccount
            }
            catch (err) {
                console.error('[Daemon] Fatal error in polling loop:', err);
            }
            finally {
                isPolling = false;
                scheduleNext();
            }
        };
        // 首次启动延迟 5s，等服务完全就绪
        setTimeout(runPoll, 5000);
    }
};
//# sourceMappingURL=pollingDaemon.js.map