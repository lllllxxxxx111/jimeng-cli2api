export type AccountFailureStatus = 'NO_VIP' | 'ERROR';

export type AccountFailureCategory = {
  status: AccountFailureStatus;
  type: 'account_permission_error' | 'account_login_error' | 'account_unavailable';
  code: string;
};

const toText = (message: unknown) => String(message || '');

export const classifyAccountFailure = (message: unknown): AccountFailureCategory | null => {
  const text = toText(message);
  const lower = text.toLowerCase();

  if (
    /未检测到有效登录态|请先执行\s*(dreamina\s*)?login|登录态.*(无效|失效|过期)|凭证.*(无效|过期)|授权.*(失效|过期)/i.test(text) ||
    /not\s+logged\s+in|login\s+required|invalid\s+token|token\s+expired|authorization\s+expired/i.test(lower)
  ) {
    return { status: 'ERROR', type: 'account_login_error', code: 'login_required' };
  }

  if (
    /master\s*vip|非\s*master|不是.*会员|非会员|高级会员|会员|未开通|开通.*会员|权限不足|无权限|没有权限/i.test(text) ||
    /vip|member|permission|forbidden|not\s+eligible|not\s+entitled|entitlement/i.test(lower)
  ) {
    return { status: 'NO_VIP', type: 'account_permission_error', code: 'vip_required' };
  }

  if (
    /all\s+dreamina\s+accounts\s+are\s+busy\s+or\s+out\s+of\s+credits/i.test(lower) ||
    /out\s+of\s+credits|no\s+credits|insufficient\s+credits|credit\s+balance/i.test(lower) ||
    /积分不足|余额不足|点数不足|额度不足|无额度/i.test(text)
  ) {
    return { status: 'NO_VIP', type: 'account_permission_error', code: 'vip_or_credit_required' };
  }

  return null;
};

export const accountStatusForFailure = (message: unknown): AccountFailureStatus => {
  return classifyAccountFailure(message)?.status || 'ERROR';
};
