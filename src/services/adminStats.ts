import os from 'os';
import { PrismaClient } from '@prisma/client';
import { DREAMINA_BIN } from '../utils/cliRunner';

const prisma = new PrismaClient();

type CountRow = Record<string, any> & { _count: { _all: number } };
type AccountSummary = {
  id: string;
  name: string;
  status: string;
  creditBalance: number;
  lastChecked: Date;
  createdAt: Date;
};

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toCountMap(rows: CountRow[], key: string) {
  const map = new Map<string, number>();
  for (const row of rows) map.set(String(row[key] ?? ''), row._count._all);
  return map;
}

function sortByCountDesc<T extends { count: number }>(rows: T[]) {
  return [...rows].sort((a, b) => b.count - a.count);
}

function formatPromptPreview(value: string, maxLength = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function buildTimeline(days: number, baseDate: Date) {
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

export async function collectAdminStats() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const timelineDays = 7;
  const timelineStart = startOfDay(new Date(now.getTime() - (timelineDays - 1) * 24 * 60 * 60 * 1000));
  const { buckets: timelineBuckets, bucketMap: timelineBucketMap } = buildTimeline(timelineDays, now);

  const [
    accounts,
    accountStatusRows,
    taskStatusRows,
    taskTypeRows,
    taskModelRows,
    apiKeyTotal,
    apiKeyActive,
    apiKeyBound,
    taskTotal,
    taskTodayTotal,
    taskTodaySuccess,
    taskTodayFailed,
    taskTodayProcessing,
    accountTaskTotalRows,
    accountTaskTodayRows,
    accountTaskProcessingRows,
    accountTaskTodaySuccessRows,
    accountTaskFailedRows,
    accountTaskTodayFailedRows,
    failedPromptRows,
    failedReasonRows,
    failedModelRows,
    failedAccountRows,
    recentWindowTasks,
    recentFailedTasks,
  ] = await Promise.all([
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
    prisma.task.groupBy({ by: ['accountId'], where: { accountId: { not: null }, status: 'PROCESSING' }, _count: { _all: true } }),
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
  const totalByAccountMap = toCountMap(accountTaskTotalRows as CountRow[], 'accountId');
  const todayByAccountMap = toCountMap(accountTaskTodayRows as CountRow[], 'accountId');
  const processingByAccountMap = toCountMap(accountTaskProcessingRows as CountRow[], 'accountId');
  const todaySuccessByAccountMap = toCountMap(accountTaskTodaySuccessRows as CountRow[], 'accountId');
  const failedByAccountMap = toCountMap(accountTaskFailedRows as CountRow[], 'accountId');
  const todayFailedByAccountMap = toCountMap(accountTaskTodayFailedRows as CountRow[], 'accountId');

  const accountRows = (accounts as AccountSummary[]).map((account) => ({
    ...account,
    totalCreatives: totalByAccountMap.get(account.id) ?? 0,
    todayCreatives: todayByAccountMap.get(account.id) ?? 0,
    processingTasks: processingByAccountMap.get(account.id) ?? 0,
    todaySuccess: todaySuccessByAccountMap.get(account.id) ?? 0,
    failedTasks: failedByAccountMap.get(account.id) ?? 0,
    todayFailed: todayFailedByAccountMap.get(account.id) ?? 0,
  }));

  const failurePromptLookup = new Map<string, string>();
  for (const task of recentFailedTasks as Array<any>) {
    const key = `${String(task.prompt ?? '')}::${String(task.model ?? '')}::${String(task.type ?? '')}`;
    if (!failurePromptLookup.has(key)) failurePromptLookup.set(key, String(task.errorMsg || task.pollErrorMsg || ''));
  }

  const failuresByPrompt = sortByCountDesc(
    (failedPromptRows as Array<any>)
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
      .filter((row) => row.prompt)
  ).slice(0, 10);

  const failuresByReason = sortByCountDesc(
    (failedReasonRows as Array<any>)
      .map((row) => ({
        reason: String(row.errorMsg ?? '').trim(),
        reasonPreview: formatPromptPreview(String(row.errorMsg ?? ''), 96),
        count: row._count._all,
        lastUpdatedAt: row._max?.updatedAt ?? null,
      }))
      .filter((row) => row.reason)
  ).slice(0, 10);

  const failuresByModel = sortByCountDesc(
    (failedModelRows as Array<any>)
      .map((row) => ({
        model: String(row.model ?? ''),
        count: row._count._all,
        lastUpdatedAt: row._max?.updatedAt ?? null,
      }))
      .filter((row) => row.model)
  ).slice(0, 10);

  const accountLookup = new Map((accounts as AccountSummary[]).map((account) => [account.id, account.name]));
  const failuresByAccount = sortByCountDesc(
    (failedAccountRows as Array<any>)
      .map((row) => ({
        id: String(row.accountId ?? ''),
        name: accountLookup.get(String(row.accountId ?? '')) || 'Unknown',
        count: row._count._all,
        lastUpdatedAt: row._max?.updatedAt ?? null,
      }))
      .filter((row) => row.id)
  ).slice(0, 10);

  for (const task of recentWindowTasks as Array<{ createdAt: Date; status: string }>) {
    const bucket = timelineBucketMap.get(formatDateKey(new Date(task.createdAt)));
    if (!bucket) continue;
    bucket.total += 1;
    if (task.status === 'SUCCESS') bucket.success += 1;
    if (task.status === 'FAILED') bucket.failed += 1;
    if (task.status === 'PROCESSING') bucket.processing += 1;
    if (task.status === 'PENDING') bucket.pending += 1;
  }

  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  return {
    generatedAt: now.toISOString(),
    runtime: {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      cliBin: DREAMINA_BIN,
      nodeVersion: process.version,
      platform: process.platform,
      cpuCount: os.cpus().length,
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
      byStatus: sortByCountDesc((taskStatusRows as CountRow[]).map((row) => ({ status: row.status, count: row._count._all }))),
      byType: sortByCountDesc((taskTypeRows as CountRow[]).map((row) => ({ type: row.type, count: row._count._all }))),
      byModel: sortByCountDesc(
        taskModelRows
          .map((row: any) => ({ model: String(row.model ?? ''), count: row._count._all }))
          .filter((row) => row.model)
      ).slice(0, 10),
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
