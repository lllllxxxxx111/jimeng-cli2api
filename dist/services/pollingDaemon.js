"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollingDaemon = void 0;
const client_1 = require("@prisma/client");
const cliRunner_1 = require("../utils/cliRunner");
const prisma = new client_1.PrismaClient();
let isPolling = false;
// 记录每个任务的连续失败次数（内存级，重启清零）
const taskErrorCount = new Map();
const MAX_POLL_ERRORS = 10; // 连续失败 10 次（约 100 秒）后自动标记 FAILED
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
function normalizeTaskState(payload, taskType) {
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (!item || typeof item !== 'object')
        return null;
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
    }
    else {
        finalUrl = item.result_json?.videos?.[0]?.video_url
            || item.result_json?.videos?.[0]?.url
            || item.result?.videos?.[0]?.video_url
            || item.video_url
            || item.url;
    }
    return { rawStatus, isProcessing, isFailed, finalUrl, item };
}
exports.pollingDaemon = {
    start() {
        console.log('[🔄] Polling Daemon started. Monitoring PROCESSING tasks every 10 seconds...');
        setInterval(async () => {
            if (isPolling)
                return;
            isPolling = true;
            try {
                const tasks = await prisma.task.findMany({
                    where: {
                        status: 'PROCESSING',
                        jimengSubmitId: { not: null }
                    },
                    include: {
                        account: true
                    }
                });
                for (const task of tasks) {
                    if (!task.jimengSubmitId)
                        continue;
                    try {
                        const homeDir = task.account?.homeDir || process.cwd();
                        console.log(`[Daemon] Polling Task ${task.id} (Submit ID: ${task.jimengSubmitId})`);
                        let payload = null;
                        let lastOutput = '';
                        try {
                            const { stdout } = await (0, cliRunner_1.runJimengCommand)(`dreamina query_result --submit_id=${task.jimengSubmitId}`, homeDir);
                            lastOutput = stdout;
                            payload = extractJsonPayload(stdout);
                        }
                        catch (queryErr) {
                            lastOutput = String(queryErr?.message || '');
                            console.warn(`[Daemon] query_result failed for ${task.id}, fallback to list_task...`);
                            const { stdout } = await (0, cliRunner_1.runJimengCommand)(`dreamina list_task --submit_id=${task.jimengSubmitId} --limit=1`, homeDir);
                            lastOutput = stdout;
                            payload = extractJsonPayload(stdout);
                        }
                        const state = normalizeTaskState(payload, task.type);
                        if (!state) {
                            throw new Error(`无法解析任务状态。Raw: ${lastOutput.substring(0, 300)}`);
                        }
                        if (state.finalUrl) {
                            console.log(`[Daemon] Task ${task.id} SUCCESS! URL: ${state.finalUrl}`);
                            await prisma.task.update({
                                where: { id: task.id },
                                data: { status: 'SUCCESS', resultUrl: state.finalUrl }
                            });
                            taskErrorCount.delete(task.id);
                        }
                        else if (state.isFailed || lastOutput.toLowerCase().includes('fail')) {
                            console.log(`[Daemon] Task ${task.id} FAILED.`);
                            await prisma.task.update({
                                where: { id: task.id },
                                data: { status: 'FAILED', errorMsg: lastOutput.substring(0, 200) }
                            });
                            taskErrorCount.delete(task.id);
                        }
                        else if (state.isProcessing || !state.rawStatus) {
                            taskErrorCount.delete(task.id);
                            console.log(`[Daemon] Task ${task.id} still processing.`);
                        }
                    }
                    catch (taskErr) {
                        const errMsg = taskErr?.message || String(taskErr);
                        const count = (taskErrorCount.get(task.id) || 0) + 1;
                        taskErrorCount.set(task.id, count);
                        console.error(`[Daemon] Error checking task ${task.id} (${count}/${MAX_POLL_ERRORS}):`, errMsg);
                        if (count >= MAX_POLL_ERRORS) {
                            console.error(`[Daemon] Task ${task.id} exceeded max retries. Marking as FAILED.`);
                            await prisma.task.update({
                                where: { id: task.id },
                                data: { status: 'FAILED', errorMsg: `轮询连续失败 ${MAX_POLL_ERRORS} 次，最后错误: ${errMsg.substring(0, 300)}` }
                            });
                            taskErrorCount.delete(task.id);
                        }
                    }
                }
            }
            catch (err) {
                console.error('[Daemon] Error in polling loop:', err);
            }
            finally {
                isPolling = false;
            }
        }, 10000);
    }
};
//# sourceMappingURL=pollingDaemon.js.map