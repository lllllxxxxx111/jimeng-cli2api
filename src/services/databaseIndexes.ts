import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const indexStatements = [
  'CREATE INDEX IF NOT EXISTS "ApiKey_boundAccountId_idx" ON "ApiKey"("boundAccountId")',
  'CREATE INDEX IF NOT EXISTS "Task_apiKeyId_idx" ON "Task"("apiKeyId")',
  'CREATE INDEX IF NOT EXISTS "Task_accountId_idx" ON "Task"("accountId")',
  'CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt")',
  'CREATE INDEX IF NOT EXISTS "Task_status_createdAt_idx" ON "Task"("status", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "Task_status_jimengSubmitId_idx" ON "Task"("status", "jimengSubmitId")',
];

export async function ensureDatabaseIndexes() {
  for (const statement of indexStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
