import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const taskColumnStatements = [
  { name: 'entrypoint', sql: 'ALTER TABLE "Task" ADD COLUMN "entrypoint" TEXT' },
  { name: 'toolType', sql: 'ALTER TABLE "Task" ADD COLUMN "toolType" TEXT' },
  { name: 'queueStatus', sql: 'ALTER TABLE "Task" ADD COLUMN "queueStatus" TEXT' },
  { name: 'queueIndex', sql: 'ALTER TABLE "Task" ADD COLUMN "queueIndex" INTEGER' },
  { name: 'queueLength', sql: 'ALTER TABLE "Task" ADD COLUMN "queueLength" INTEGER' },
  { name: 'queueWaitSeconds', sql: 'ALTER TABLE "Task" ADD COLUMN "queueWaitSeconds" INTEGER' },
  { name: 'progressPercent', sql: 'ALTER TABLE "Task" ADD COLUMN "progressPercent" INTEGER' },
  { name: 'liveStatusRaw', sql: 'ALTER TABLE "Task" ADD COLUMN "liveStatusRaw" TEXT' },
  { name: 'lastPolledAt', sql: 'ALTER TABLE "Task" ADD COLUMN "lastPolledAt" DATETIME' },
];

const indexStatements = [
  'CREATE INDEX IF NOT EXISTS "ApiKey_boundAccountId_idx" ON "ApiKey"("boundAccountId")',
  'CREATE INDEX IF NOT EXISTS "Task_apiKeyId_idx" ON "Task"("apiKeyId")',
  'CREATE INDEX IF NOT EXISTS "Task_accountId_idx" ON "Task"("accountId")',
  'CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt")',
  'CREATE INDEX IF NOT EXISTS "Task_status_createdAt_idx" ON "Task"("status", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "Task_status_jimengSubmitId_idx" ON "Task"("status", "jimengSubmitId")',
];

async function ensureTaskColumns() {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("Task")');
  const existing = new Set(columns.map((column) => column.name));
  for (const column of taskColumnStatements) {
    if (!existing.has(column.name)) {
      await prisma.$executeRawUnsafe(column.sql);
    }
  }
}

export async function ensureDatabaseIndexes() {
  await ensureTaskColumns();
  for (const statement of indexStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
