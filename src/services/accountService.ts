import { PrismaClient, JimengAccount } from '@prisma/client';

const prisma = new PrismaClient();

export const accountService = {
  /**
   * 独占获取一个空闲账号 (类似数据库行锁/乐观锁分配，这里简单用 findFirst + update处理)
   */
  async getIdleAccount(boundAccountId?: string | null): Promise<JimengAccount | null> {
    // 用事务保证 find + update 的原子性，避免并发时两个请求拿到同一个账号
    return await prisma.$transaction(async (tx) => {
      if (boundAccountId) {
        // 绑定模式：只使用指定账号，不走公共池
        const account = await tx.jimengAccount.findFirst({
          where: { id: boundAccountId, status: 'IDLE' }
        });
        if (!account) return null;
        return await tx.jimengAccount.update({
          where: { id: account.id },
          data: { status: 'BUSY' }
        });
      }

      // 公共池模式：从所有空闲账号中取一个（不过滤余额，超级会员生图0积分）
      const account = await tx.jimengAccount.findFirst({
        where: {
          status: 'IDLE',
        }
      });

      if (!account) return null;

      return await tx.jimengAccount.update({
        where: { id: account.id },
        data: { status: 'BUSY' }
      });
    });
  },

  /**
   * 释放账号
   */
  async releaseAccount(accountId: string, newStatus: string = 'IDLE') {
    return await prisma.jimengAccount.update({
      where: { id: accountId },
      data: { status: newStatus }
    });
  },

  async getUnavailableReason(boundAccountId?: string | null): Promise<{ statusCode: number; message: string }> {
    if (boundAccountId) {
      const account = await prisma.jimengAccount.findUnique({ where: { id: boundAccountId } });
      if (!account) {
        return { statusCode: 404, message: 'Bound Dreamina account was not found. Rebind the API key to an existing account.' };
      }
      if (account.status === 'NO_VIP') {
        return { statusCode: 403, message: `Bound Dreamina account "${account.name}" is not eligible for this CLI model or has no credits. Use a Master VIP account or rebind the API key.` };
      }
      if (account.status === 'ERROR') {
        return { statusCode: 409, message: `Bound Dreamina account "${account.name}" is not logged in or failed health check. Reauthorize it before submitting.` };
      }
      if (account.status === 'PENDING_LOGIN') {
        return { statusCode: 409, message: `Bound Dreamina account "${account.name}" is still pending authorization. Finish login before submitting.` };
      }
      if (account.status === 'BUSY') {
        return { statusCode: 409, message: `Bound Dreamina account "${account.name}" is currently busy. Please try again later.` };
      }
      return { statusCode: 503, message: `Bound Dreamina account "${account.name}" is not available for scheduling.` };
    }

    const accounts = await prisma.jimengAccount.findMany({ select: { status: true } });
    if (accounts.length === 0) {
      return { statusCode: 503, message: 'No Dreamina accounts are configured. Add and authorize an account before submitting.' };
    }

    const count = (status: string) => accounts.filter((account) => account.status === status).length;
    const noVip = count('NO_VIP');
    const errors = count('ERROR');
    const pending = count('PENDING_LOGIN');
    const busy = count('BUSY');

    if (noVip > 0 && noVip + errors + pending + busy === accounts.length) {
      return { statusCode: 403, message: 'All Dreamina accounts are unavailable because they are not Master VIP eligible, have no credits, need reauthorization, or are busy.' };
    }
    if (errors > 0 || pending > 0) {
      return { statusCode: 409, message: 'No usable Dreamina account is available. Some accounts need login, health check, or authorization cleanup.' };
    }
    return { statusCode: 503, message: 'All Dreamina accounts are busy. Please try again later.' };
  }
};
