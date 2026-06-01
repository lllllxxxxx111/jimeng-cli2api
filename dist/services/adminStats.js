"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectAdminStats = collectAdminStats;
const os_1 = __importDefault(require("os"));
const client_1 = require("@prisma/client");
const cliRunner_1 = require("../utils/cliRunner");
const prisma = new client_1.PrismaClient();
function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function toCountMap(rows, key) {
    const map = new Map();
    for (const row of rows)
        map.set(String(row[key] ?? ''), row._count._all);
    return map;
}
function sortByCountDesc(rows) {
    return [...rows].sort((a, b) => b.count - a.count);
}
function formatPromptPreview(value, maxLength = 72) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength)
        return text;
    return `${text.slice(0, maxLength - 1)}...`;
}
const VIDEO_TASK_TYPES = new Set(['text2video', 'image2video', 'frames2video', 'multiframe2video', 'multimodal2video']);
function normalizeToolType(toolType, taskType) {
    const explicit = String(toolType || '').trim();
    if (explicit) {
        if (explicit === 'video_generation')
            return 'dreamina_video_generation';
        return explicit;
    }
    const type = String(taskType || '').trim();
    if (type === 'image_upscale')
        return 'image_upscale';
    if (type === 'text2image' || type === 'image2image')
        return 'image_generation';
    if (VIDEO_TASK_TYPES.has(type))
        return 'dreamina_video_generation';
    return type || 'unknown';
}
function toolTypeLabel(toolType) {
    return {
        image_generation: '图片生成工具',
        dreamina_video_generation: '视频生成工具',
        image_upscale: '图片放大工具',
    }[toolType] || toolType;
}
function buildTimeline(days, baseDate) {
    const buckets = Array.from({ length: days }, (_, index) => {
        const date = new Date(baseDate);
        date.setDate(date.getDate() - (days - 1 - index));
        date.setHours(0, 0, 0, 0);
        return {
            dateKey: formatDateKey(date),
            label: `${date.getMonth() + 1}/${date.getDate()}`,
            total: 0,
            success: 0,
            failed: 0,
            processing: 0,
            pending: 0,
        };
    });
    return { buckets, bucketMap: new Map(buckets.map((bucket) => [bucket.dateKey, bucket])) };
}
async function collectAdminStats() {
    const now = new Date();
    const todayStart = startOfDay(now);
    const timelineDays = 7;
    const timelineStart = startOfDay(new Date(now.getTime() - (timelineDays - 1) * 24 * 60 * 60 * 1000));
    const { buckets: timelineBuckets, bucketMap: timelineBucketMap } = buildTimeline(timelineDays, now);
    const [accounts, accountStatusRows, taskStatusRows, taskTypeRows, taskModelRows, taskToolRows, taskToolTodayRows, apiKeyTotal, apiKeyActive, apiKeyBound, taskTotal, taskTodayTotal, taskTodaySuccess, taskTodayFailed, taskTodayProcessing, accountTaskTotalRows, accountTaskTodayRows, accountTaskProcessingRows, accountTaskTodaySuccessRows, accountTaskFailedRows, accountTaskTodayFailedRows, failedPromptRows, failedReasonRows, failedModelRows, failedAccountRows, recentWindowTasks, recentFailedTasks,] = await Promise.all([
        prisma.jimengAccount.findMany({
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                name: true,
                status: true,
                creditBalance: true,
                lastChecked: true,
                createdAt: true,
            },
        }),
        prisma.jimengAccount.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.task.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.task.groupBy({ by: ['type'], _count: { _all: true } }),
        prisma.task.groupBy({ by: ['model'], where: { model: { not: null } }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['toolType', 'type', 'status'], _count: { _all: true } }),
        prisma.task.groupBy({ by: ['toolType', 'type', 'status'], where: { createdAt: { gte: todayStart } }, _count: { _all: true } }),
        prisma.apiKey.count(),
        prisma.apiKey.count({ where: { isActive: true } }),
        prisma.apiKey.count({ where: { boundAccountId: { not: null } } }),
        prisma.task.count(),
        prisma.task.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.task.count({ where: { createdAt: { gte: todayStart }, status: 'SUCCESS' } }),
        prisma.task.count({ where: { createdAt: { gte: todayStart }, status: 'FAILED' } }),
        prisma.task.count({ where: { status: 'PROCESSING' } }),
        prisma.task.groupBy({ by: ['accountId'], where: { accountId: { not: null } }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['accountId'], where: { accountId: { not: null }, createdAt: { gte: todayStart } }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['accountId'], where: { accountId: { not: null }, status: { in: ['PENDING', 'PROCESSING'] } }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['accountId'], where: { accountId: { not: null }, createdAt: { gte: todayStart }, status: 'SUCCESS' }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['accountId'], where: { accountId: { not: null }, status: 'FAILED' }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['accountId'], where: { accountId: { not: null }, createdAt: { gte: todayStart }, status: 'FAILED' }, _count: { _all: true } }),
        prisma.task.groupBy({
            by: ['prompt', 'model', 'type'],
            where: { status: 'FAILED' },
            _count: { _all: true },
            _max: { createdAt: true },
        }),
        prisma.task.groupBy({
            by: ['errorMsg'],
            where: { status: 'FAILED', errorMsg: { not: null } },
            _count: { _all: true },
            _max: { updatedAt: true },
        }),
        prisma.task.groupBy({
            by: ['model'],
            where: { status: 'FAILED', model: { not: null } },
            _count: { _all: true },
            _max: { updatedAt: true },
        }),
        prisma.task.groupBy({
            by: ['accountId'],
            where: { status: 'FAILED', accountId: { not: null } },
            _count: { _all: true },
            _max: { updatedAt: true },
        }),
        prisma.task.findMany({
            where: { createdAt: { gte: timelineStart } },
            select: { createdAt: true, status: true },
        }),
        prisma.task.findMany({
            where: { status: 'FAILED' },
            orderBy: { updatedAt: 'desc' },
            take: 20,
            select: {
                id: true,
                prompt: true,
                model: true,
                type: true,
                entrypoint: true,
                toolType: true,
                status: true,
                errorMsg: true,
                pollErrorMsg: true,
                createdAt: true,
                updatedAt: true,
                jimengSubmitId: true,
                jimengLogId: true,
                resultUrl: true,
                account: { select: { id: true, name: true } },
                apiKey: { select: { id: true, owner: true } },
            },
        }),
    ]);
    const accountStatusMap = toCountMap(accountStatusRows, 'status');
    const taskStatusMap = toCountMap(taskStatusRows, 'status');
    const totalByAccountMap = toCountMap(accountTaskTotalRows, 'accountId');
    const todayByAccountMap = toCountMap(accountTaskTodayRows, 'accountId');
    const processingByAccountMap = toCountMap(accountTaskProcessingRows, 'accountId');
    const todaySuccessByAccountMap = toCountMap(accountTaskTodaySuccessRows, 'accountId');
    const failedByAccountMap = toCountMap(accountTaskFailedRows, 'accountId');
    const todayFailedByAccountMap = toCountMap(accountTaskTodayFailedRows, 'accountId');
    const accountRows = accounts.map((account) => ({
        ...account,
        totalCreatives: totalByAccountMap.get(account.id) ?? 0,
        todayCreatives: todayByAccountMap.get(account.id) ?? 0,
        processingTasks: processingByAccountMap.get(account.id) ?? 0,
        todaySuccess: todaySuccessByAccountMap.get(account.id) ?? 0,
        failedTasks: failedByAccountMap.get(account.id) ?? 0,
        todayFailed: todayFailedByAccountMap.get(account.id) ?? 0,
    }));
    const failurePromptLookup = new Map();
    for (const task of recentFailedTasks) {
        const key = `${String(task.prompt ?? '')}::${String(task.model ?? '')}::${String(task.type ?? '')}`;
        if (!failurePromptLookup.has(key))
            failurePromptLookup.set(key, String(task.errorMsg || task.pollErrorMsg || ''));
    }
    const failuresByPrompt = sortByCountDesc(failedPromptRows
        .map((row) => {
        const prompt = String(row.prompt ?? '').trim();
        const model = row.model ? String(row.model) : '';
        const type = row.type ? String(row.type) : '';
        return {
            prompt,
            promptPreview: formatPromptPreview(prompt),
            model,
            type,
            count: row._count._all,
            lastFailedAt: row._max?.createdAt ?? null,
            sampleError: failurePromptLookup.get(`${prompt}::${model}::${type}`) || '',
        };
    })
        .filter((row) => row.prompt)).slice(0, 10);
    const failuresByReason = sortByCountDesc(failedReasonRows
        .map((row) => ({
        reason: String(row.errorMsg ?? '').trim(),
        reasonPreview: formatPromptPreview(String(row.errorMsg ?? ''), 96),
        count: row._count._all,
        lastUpdatedAt: row._max?.updatedAt ?? null,
    }))
        .filter((row) => row.reason)).slice(0, 10);
    const failuresByModel = sortByCountDesc(failedModelRows
        .map((row) => ({
        model: String(row.model ?? ''),
        count: row._count._all,
        lastUpdatedAt: row._max?.updatedAt ?? null,
    }))
        .filter((row) => row.model)).slice(0, 10);
    const accountLookup = new Map(accounts.map((account) => [account.id, account.name]));
    const failuresByAccount = sortByCountDesc(failedAccountRows
        .map((row) => ({
        id: String(row.accountId ?? ''),
        name: accountLookup.get(String(row.accountId ?? '')) || 'Unknown',
        count: row._count._all,
        lastUpdatedAt: row._max?.updatedAt ?? null,
    }))
        .filter((row) => row.id)).slice(0, 10);
    const toolMetrics = new Map();
    const ensureToolMetric = (toolType) => {
        if (!toolMetrics.has(toolType)) {
            toolMetrics.set(toolType, {
                toolType,
                label: toolTypeLabel(toolType),
                total: 0,
                success: 0,
                failed: 0,
                processing: 0,
                pending: 0,
                todayTotal: 0,
                todayFailed: 0,
            });
        }
        return toolMetrics.get(toolType);
    };
    for (const row of taskToolRows) {
        const metric = ensureToolMetric(normalizeToolType(row.toolType, row.type));
        const count = row._count._all;
        metric.total += count;
        if (row.status === 'SUCCESS')
            metric.success += count;
        if (row.status === 'FAILED')
            metric.failed += count;
        if (row.status === 'PROCESSING')
            metric.processing += count;
        if (row.status === 'PENDING')
            metric.pending += count;
    }
    for (const row of taskToolTodayRows) {
        const metric = ensureToolMetric(normalizeToolType(row.toolType, row.type));
        const count = row._count._all;
        metric.todayTotal += count;
        if (row.status === 'FAILED')
            metric.todayFailed += count;
    }
    const toolRows = Array.from(toolMetrics.values()).map((metric) => ({
        ...metric,
        active: metric.processing + metric.pending,
        failureRate: metric.total > 0 ? metric.failed / metric.total : 0,
        todayFailureRate: metric.todayTotal > 0 ? metric.todayFailed / metric.todayTotal : 0,
    })).sort((a, b) => b.total - a.total || b.active - a.active || a.label.localeCompare(b.label));
    const toolTotals = toolRows.reduce((acc, row) => {
        acc.total += row.total;
        acc.success += row.success;
        acc.failed += row.failed;
        acc.processing += row.processing;
        acc.pending += row.pending;
        acc.todayTotal += row.todayTotal;
        acc.todayFailed += row.todayFailed;
        return acc;
    }, { total: 0, success: 0, failed: 0, processing: 0, pending: 0, todayTotal: 0, todayFailed: 0 });
    for (const task of recentWindowTasks) {
        const bucket = timelineBucketMap.get(formatDateKey(new Date(task.createdAt)));
        if (!bucket)
            continue;
        bucket.total += 1;
        if (task.status === 'SUCCESS')
            bucket.success += 1;
        if (task.status === 'FAILED')
            bucket.failed += 1;
        if (task.status === 'PROCESSING')
            bucket.processing += 1;
        if (task.status === 'PENDING')
            bucket.pending += 1;
    }
    const memoryUsage = process.memoryUsage();
    const totalMemory = os_1.default.totalmem();
    const freeMemory = os_1.default.freemem();
    const usedMemory = totalMemory - freeMemory;
    return {
        generatedAt: now.toISOString(),
        runtime: {
            pid: process.pid,
            uptimeSeconds: Math.floor(process.uptime()),
            cliBin: cliRunner_1.DREAMINA_BIN,
            nodeVersion: process.version,
            platform: process.platform,
            cpuCount: os_1.default.cpus().length,
            memory: {
                rss: memoryUsage.rss,
                heapUsed: memoryUsage.heapUsed,
                heapTotal: memoryUsage.heapTotal,
            },
            systemMemory: {
                total: totalMemory,
                free: freeMemory,
                used: usedMemory,
                usedPercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
            },
        },
        accounts: {
            total: accounts.length,
            idle: accountStatusMap.get('IDLE') ?? 0,
            busy: accountStatusMap.get('BUSY') ?? 0,
            error: accountStatusMap.get('ERROR') ?? 0,
            offline: accountStatusMap.get('OFFLINE') ?? 0,
            noVip: accountStatusMap.get('NO_VIP') ?? 0,
            accounts: accountRows,
        },
        apiKeys: {
            total: apiKeyTotal,
            active: apiKeyActive,
            inactive: apiKeyTotal - apiKeyActive,
            bound: apiKeyBound,
            unbound: apiKeyTotal - apiKeyBound,
        },
        tasks: {
            total: taskTotal,
            processing: taskStatusMap.get('PROCESSING') ?? 0,
            pending: taskStatusMap.get('PENDING') ?? 0,
            success: taskStatusMap.get('SUCCESS') ?? 0,
            failed: taskStatusMap.get('FAILED') ?? 0,
            failureRate: taskTotal > 0 ? ((taskStatusMap.get('FAILED') ?? 0) / taskTotal) : 0,
            today: {
                total: taskTodayTotal,
                success: taskTodaySuccess,
                failed: taskTodayFailed,
                processing: taskTodayProcessing,
                failureRate: taskTodayTotal > 0 ? taskTodayFailed / taskTodayTotal : 0,
            },
            byStatus: sortByCountDesc(taskStatusRows.map((row) => ({ status: row.status, count: row._count._all }))),
            byType: sortByCountDesc(taskTypeRows.map((row) => ({ type: row.type, count: row._count._all }))),
            byModel: sortByCountDesc(taskModelRows
                .map((row) => ({ model: String(row.model ?? ''), count: row._count._all }))
                .filter((row) => row.model)).slice(0, 10),
        },
        tools: {
            total: toolTotals.total,
            success: toolTotals.success,
            failed: toolTotals.failed,
            processing: toolTotals.processing,
            pending: toolTotals.pending,
            active: toolTotals.processing + toolTotals.pending,
            failureRate: toolTotals.total > 0 ? toolTotals.failed / toolTotals.total : 0,
            today: {
                total: toolTotals.todayTotal,
                failed: toolTotals.todayFailed,
                failureRate: toolTotals.todayTotal > 0 ? toolTotals.todayFailed / toolTotals.todayTotal : 0,
            },
            byType: toolRows,
        },
        failures: {
            total: taskStatusMap.get('FAILED') ?? 0,
            today: taskTodayFailed,
            rate: taskTotal > 0 ? ((taskStatusMap.get('FAILED') ?? 0) / taskTotal) : 0,
            todayRate: taskTodayTotal > 0 ? taskTodayFailed / taskTodayTotal : 0,
            byPrompt: failuresByPrompt,
            byReason: failuresByReason,
            byModel: failuresByModel,
            byAccount: failuresByAccount,
            recent: recentFailedTasks,
            timeline: timelineBuckets.map((bucket) => ({
                ...bucket,
                failureRate: bucket.total > 0 ? bucket.failed / bucket.total : 0,
            })),
        },
    };
}
//# sourceMappingURL=adminStats.js.map