import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { runJimengCommand, DREAMINA_BIN, saveCredentialBackup, withCredSwap, generateFreshCredential } from '../utils/cliRunner';
import path from 'path';
import { randomBytes } from 'crypto';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { adminAuth } from '../middleware/adminAuth';
import { collectAdminStats } from '../services/adminStats';

const router = Router();
const prisma = new PrismaClient();
const OAUTH_CONTEXT_FILE = '.dreamina_oauth_context.json';
const PROMPT_RISK_LIMIT = 8;
const CHECKLOGIN_POLL_SECONDS = 3;
const CHECKLOGIN_TIMEOUT_MS = 12000;
const ACCOUNT_CHECK_TIMEOUT_MS = 30000;
const NATIVE_CLI_TIMEOUT_MS = 60000;
const NATIVE_CLI_DOWNLOAD_TIMEOUT_MS = 1000 * 60 * 5;
const NATIVE_DOWNLOAD_ROOT = path.resolve(__dirname, '../../data/downloads');
const ACCOUNTS_ROOT = path.resolve(__dirname, '../../data/accounts');
const SAFE_CLI_TOKEN = /^[A-Za-z0-9_.:-]+$/;
const SAFE_SUBMIT_ID = /^[A-Za-z0-9_-]+$/;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const shellQuote = (value: string): string => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const assertInside = (root: string, target: string, message: string) => {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return resolvedTarget;
  }
  throw new Error(message);
};

const safeAccountDirName = (name: string) => {
  const safe = name.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return safe || 'account';
};

const getClientKey = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

const getLoginAttempt = (key: string) => {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(key, fresh);
    return fresh;
  }
  return current;
};

const recordFailedLogin = (key: string) => {
  const attempt = getLoginAttempt(key);
  attempt.count += 1;
};

const clearLoginAttempts = (key: string) => loginAttempts.delete(key);

const getScalar = (value: unknown): string => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === undefined || raw === null ? '' : String(raw).trim();
};

const parseIntParam = (
  value: unknown,
  field: string,
  options: { min: number; max: number; defaultValue: number }
) => {
  const text = getScalar(value);
  if (!text) return options.defaultValue;
  if (!/^-?\d+$/.test(text)) throw new Error(`${field} must be an integer`);
  const parsed = Number(text);
  if (parsed < options.min || parsed > options.max) {
    throw new Error(`${field} must be between ${options.min} and ${options.max}`);
  }
  return parsed;
};

const validateSafeToken = (value: string, field: string, maxLength = 80) => {
  const text = value.trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > maxLength || !SAFE_CLI_TOKEN.test(text)) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return text;
};

const validateSubmitId = (value: string) => {
  const text = value.trim();
  if (!text) throw new Error('submit_id is required');
  if (text.length > 128 || !SAFE_SUBMIT_ID.test(text)) {
    throw new Error('submit_id contains unsupported characters');
  }
  return text;
};

const validateSessionName = (value: string, required: boolean) => {
  const text = value.trim();
  if (!text && !required) return '';
  if (!text) throw new Error('session name is required');
  if (text.length > 50) throw new Error('session name must be at most 50 characters');
  return text;
};

const validateSessionId = (value: string) => {
  const text = value.trim();
  if (!/^\d+$/.test(text)) throw new Error('session_id must be a positive integer');
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('session_id must be greater than 0');
  }
  return String(id);
};

const parseCliJson = (stdout: string) => {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
};

const parseNativeDownloadFlag = (value: unknown) => {
  const text = getScalar(value).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
};

const getSafeDownloadDir = (submitId: string, rawName: string) => {
  const fallbackName = submitId.replace(/[^A-Za-z0-9_.-]/g, '_');
  const cleanName = (rawName || fallbackName).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100) || fallbackName;
  const target = path.resolve(NATIVE_DOWNLOAD_ROOT, cleanName);
  assertInside(NATIVE_DOWNLOAD_ROOT, target, 'download directory is outside the allowed data/downloads folder');
  fs.mkdirSync(target, { recursive: true });
  return target;
};

const getAccountForNativeCli = async (accountId: string) => {
  const id = getScalar(accountId);
  if (!id) throw new Error('accountId is required');
  const account = await prisma.jimengAccount.findUnique({ where: { id } });
  if (!account) {
    const error = new Error('account not found');
    (error as any).statusCode = 404;
    throw error;
  }
  return account;
};

const runNativeCli = async (accountId: string, command: string, timeoutMs = NATIVE_CLI_TIMEOUT_MS) => {
  const account = await getAccountForNativeCli(accountId);
  const startedAt = Date.now();
  const { stdout, stderr } = await runJimengCommand(command, account.homeDir, false, timeoutMs);
  return {
    success: true,
    accountId: account.id,
    accountName: account.name,
    command,
    stdout,
    stderr,
    parsed: parseCliJson(stdout),
    elapsedMs: Date.now() - startedAt,
  };
};

const nativeCapabilities = {
  session: {
    exposed: true,
    commands: ['list', 'create', 'search', 'rename', 'delete'],
    note: 'Admin-only session management. Login/logout/help/version are intentionally not exposed to API clients.',
  },
  list_task: {
    exposed: true,
    filters: ['gen_status', 'gen_task_type', 'submit_id', 'limit', 'offset'],
  },
  query_result: {
    exposed: true,
    filters: ['submit_id'],
    downloadRoot: NATIVE_DOWNLOAD_ROOT,
  },
};

const startOfLocalDay = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const rowsToCountMap = (rows: Array<any>, key: string) => new Map(
  rows.map((row) => [String(row[key]), row._count._all])
);

async function getAccountTaskMetrics(accountIds: string[]) {
  if (!accountIds.length) return new Map<string, any>();
  const todayStart = startOfLocalDay();
  const [
    totalRows,
    todayRows,
    processingRows,
    todaySuccessRows,
    failedRows,
    todayFailedRows,
  ] = await Promise.all([
    prisma.task.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, createdAt: { gte: todayStart } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, status: { in: ['PENDING', 'PROCESSING'] } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, createdAt: { gte: todayStart }, status: 'SUCCESS' }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, status: 'FAILED' }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, createdAt: { gte: todayStart }, status: 'FAILED' }, _count: { _all: true } }),
  ]);

  const totalMap = rowsToCountMap(totalRows, 'accountId');
  const todayMap = rowsToCountMap(todayRows, 'accountId');
  const processingMap = rowsToCountMap(processingRows, 'accountId');
  const todaySuccessMap = rowsToCountMap(todaySuccessRows, 'accountId');
  const failedMap = rowsToCountMap(failedRows, 'accountId');
  const todayFailedMap = rowsToCountMap(todayFailedRows, 'accountId');

  return new Map(accountIds.map((id) => [id, {
    totalCreatives: totalMap.get(id) ?? 0,
    todayCreatives: todayMap.get(id) ?? 0,
    processingTasks: processingMap.get(id) ?? 0,
    todaySuccess: todaySuccessMap.get(id) ?? 0,
    failedTasks: failedMap.get(id) ?? 0,
    todayFailed: todayFailedMap.get(id) ?? 0,
  }]));
}

async function getApiKeyTaskMetrics(apiKeyIds: string[]) {
  if (!apiKeyIds.length) return new Map<string, any>();
  const todayStart = startOfLocalDay();
  const [
    totalRows,
    todayRows,
    successRows,
    failedRows,
    processingRows,
  ] = await Promise.all([
    prisma.task.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: apiKeyIds } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: apiKeyIds }, createdAt: { gte: todayStart } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: apiKeyIds }, status: 'SUCCESS' }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: apiKeyIds }, status: 'FAILED' }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: apiKeyIds }, status: { in: ['PENDING', 'PROCESSING'] } }, _count: { _all: true } }),
  ]);

  const totalMap = rowsToCountMap(totalRows, 'apiKeyId');
  const todayMap = rowsToCountMap(todayRows, 'apiKeyId');
  const successMap = rowsToCountMap(successRows, 'apiKeyId');
  const failedMap = rowsToCountMap(failedRows, 'apiKeyId');
  const processingMap = rowsToCountMap(processingRows, 'apiKeyId');

  return new Map(apiKeyIds.map((id) => [id, {
    total: totalMap.get(id) ?? 0,
    today: todayMap.get(id) ?? 0,
    success: successMap.get(id) ?? 0,
    failed: failedMap.get(id) ?? 0,
    processing: processingMap.get(id) ?? 0,
  }]));
}

function normalizePromptForRisk(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function promptSimilarity(a: string, b: string) {
  const left = normalizePromptForRisk(a);
  const right = normalizePromptForRisk(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }

  const leftTokens = new Set(left.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const rightTokens = new Set(right.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

router.post('/sys/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '密码不能为空' });
  const clientKey = getClientKey(req);
  const attempt = getLoginAttempt(clientKey);
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ error: '登录失败次数过多，请稍后再试' });
  }
  const configPath = path.resolve(__dirname, '../../data/admin.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  const match = await bcrypt.compare(password, config.password);
  if (match) {
    clearLoginAttempts(clientKey);
    const token = 'admin_token_' + randomBytes(32).toString('hex');
    config.token = token;
    fs.writeFileSync(configPath, JSON.stringify(config));
    return res.json({ token });
  }
  recordFailedLogin(clientKey);
  res.status(401).json({ error: '密码错误' });
});

router.post('/sys/password', adminAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '密码不能为空' });
  const configPath = path.resolve(__dirname, '../../data/admin.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  const match = await bcrypt.compare(oldPassword, config.password);
  if (match) {
    config.password = await bcrypt.hash(newPassword, 10);
    config.token = 'admin_token_' + randomBytes(32).toString('hex'); // force relogin
    fs.writeFileSync(configPath, JSON.stringify(config));
    return res.json({ success: true, message: '密码修改成功，请重新登录' });
  }
  res.status(401).json({ error: '旧密码错误' });
});

router.get('/sys/check', adminAuth, (req, res) => res.json({ ok: true }));

// Apply middleware to subsequent routes
router.use(adminAuth);

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await collectAdminStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/prompt-risk', async (req: Request, res: Response) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const model = String(req.body?.model || '').trim();
    const type = String(req.body?.type || '').trim();
    if (!prompt) return res.status(400).json({ error: '提示词不能为空' });

    const rows = await prisma.task.findMany({
      where: {
        status: 'FAILED',
        prompt: { not: '' },
        ...(model ? { model } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        id: true,
        prompt: true,
        model: true,
        type: true,
        errorMsg: true,
        pollErrorMsg: true,
        updatedAt: true,
      },
    });

    const matches = rows
      .map((row) => ({
        ...row,
        similarity: promptSimilarity(prompt, row.prompt),
        reason: row.errorMsg || row.pollErrorMsg || '',
      }))
      .filter((row) => row.similarity >= 0.35)
      .sort((a, b) => b.similarity - a.similarity || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, PROMPT_RISK_LIMIT);

    const highest = matches[0]?.similarity || 0;
    const level = highest >= 0.9 || matches.length >= 3 ? 'high' : highest >= 0.55 ? 'medium' : matches.length > 0 ? 'low' : 'clear';
    const suggestion = level === 'clear'
      ? '历史失败记录中未发现相似提示词。'
      : '发现相似失败记录，建议先改写敏感表达、降低违规风险，再进入排队生成。';

    res.json({
      prompt,
      model: model || null,
      type: type || null,
      level,
      highestSimilarity: highest,
      matches,
      suggestion,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function saveOAuthContext(accountHomeDir: string, ctx: any) {
  fs.writeFileSync(path.join(accountHomeDir, OAUTH_CONTEXT_FILE), JSON.stringify(ctx, null, 2), 'utf8');
}

function readOAuthContext(accountHomeDir: string) {
  const filePath = path.join(accountHomeDir, OAUTH_CONTEXT_FILE);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

// 解析 OAuth Device Flow 输出（verification_uri / user_code / device_code / expires_at）
function parseOAuthOutput(output: string) {
  const verificationUri = output.match(/verification_uri:\s*(\S+)/)?.[1] || null;
  const userCode = output.match(/user_code:\s*(\S+)/)?.[1] || null;
  const deviceCode = output.match(/device_code:\s*(\S+)/)?.[1] || null;
  const expiresAt = output.match(/expires_at:\s*(\S+)/)?.[1] || null;
  return { verificationUri, userCode, deviceCode, expiresAt };
}

// 添加新即梦账号并触发 OAuth Device Flow 登录
router.post('/accounts/login', async (req: Request, res: Response) => {
  const { name } = req.body;
  const displayName = String(name || '').trim();
  if (!displayName) return res.status(400).json({ error: '账号名称不能为空' });
  if (displayName.length > 50) return res.status(400).json({ error: '账号名称不能超过 50 个字符' });

  try {
    const homeDir = assertInside(
      ACCOUNTS_ROOT,
      path.resolve(ACCOUNTS_ROOT, `${safeAccountDirName(displayName)}_${Date.now()}`),
      'account homeDir is outside the allowed data/accounts folder'
    );

    const account = await prisma.jimengAccount.create({
      data: { name: displayName, homeDir, status: 'IDLE', creditBalance: 0 }
    });

    const { spawn } = require('child_process');
    const absoluteHome = path.resolve(account.homeDir);
    // 确保 homeDir 存在（隔离目录），否则 Go CLI 会回退到真实用户 home
    fs.mkdirSync(absoluteHome, { recursive: true });
    const env = { ...process.env, HOME: absoluteHome, USERPROFILE: absoluteHome, APPDATA: absoluteHome, LOCALAPPDATA: absoluteHome };

    // 生成唯一 random_secret_key：确保此账号在 Windows Credential Manager 中有独立条目
    // relogin 删的是当前 credential 里新 key 对应的 CM 条目（根本不存在），不会影响其他账号
    generateFreshCredential(absoluteHome);
    let oauthResult: ReturnType<typeof parseOAuthOutput>;
    try {
      // cmMode='clear': 删除 CM 条目，让 relogin 看到空状态，不触发旧账号的服务端 logout
      oauthResult = await withCredSwap(absoluteHome, () => new Promise<ReturnType<typeof parseOAuthOutput>>((resolve, reject) => {
        const child = spawn(DREAMINA_BIN, ['relogin', '--headless'], { env, shell: false, windowsHide: true });
        let allOutput = '';
        let done = false;
        const finish = (ok?: ReturnType<typeof parseOAuthOutput>, err?: Error) => {
          if (done) return;
          done = true;
          if (err) reject(err); else resolve(ok!);
        };
        const tryParse = (chunk: string) => {
          allOutput += chunk;
          console.log(`[Login stdout/err]: ${chunk}`);
          const parsed = parseOAuthOutput(allOutput);
          if (parsed.deviceCode && parsed.verificationUri) {
            saveOAuthContext(absoluteHome, { ...parsed, updatedAt: new Date().toISOString() });
            finish(parsed);
          }
        };
        child.stdout.on('data', (d: any) => tryParse(d.toString()));
        child.stderr.on('data', (d: any) => tryParse(d.toString()));
        child.on('close', (code: any) => finish(undefined, new Error(`CLI 退出 (code=${code})，未获取到授权信息。`)));
        child.on('error', (err: any) => finish(undefined, err));
        setTimeout(() => finish(undefined, new Error('等待授权信息超时（15秒）。')), 15000);
      }), 'clear');
    } catch (err: any) {
      // spawn 失败：清理刚创建的 DB 记录和 homeDir，避免留下孤立账号
      try {
        await prisma.jimengAccount.delete({ where: { id: account.id } });
        if (fs.existsSync(absoluteHome)) fs.rmSync(absoluteHome, { recursive: true, force: true });
      } catch {}
      return res.status(500).json({ error: err.message });
    }
    return res.json({ account, ...oauthResult });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 重新登录（OAuth Device Flow）
router.post('/accounts/:id/relogin', async (req: Request, res: Response) => {
  try {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: "账号不存在" });

    const { spawn } = require('child_process');
    const absoluteHome = path.resolve(account.homeDir);
    // 确保 homeDir 存在（隔离目录）
    fs.mkdirSync(absoluteHome, { recursive: true });
    const env = { ...process.env, HOME: absoluteHome, USERPROFILE: absoluteHome, APPDATA: absoluteHome, LOCALAPPDATA: absoluteHome };

    // 生成唯一 random_secret_key：确保此账号在 Windows Credential Manager 中有独立条目
    // relogin 删的是当前 credential 里新 key 对应的 CM 条目（根本不存在），不会影响其他账号
    generateFreshCredential(absoluteHome);
    let oauthResult: ReturnType<typeof parseOAuthOutput>;
    try {
      // cmMode='clear': 删除 CM 条目，让 relogin 看到空状态，不触发旧账号的服务端 logout
      oauthResult = await withCredSwap(absoluteHome, () => new Promise<ReturnType<typeof parseOAuthOutput>>((resolve, reject) => {
        const child = spawn(DREAMINA_BIN, ['relogin', '--headless'], { env, shell: false, windowsHide: true });
        let allOutput = '';
        let done = false;
        const finish = (ok?: ReturnType<typeof parseOAuthOutput>, err?: Error) => {
          if (done) return;
          done = true;
          if (err) reject(err); else resolve(ok!);
        };
        const tryParse = (chunk: string) => {
          allOutput += chunk;
          console.log(`[Relogin stdout/err]: ${chunk}`);
          const parsed = parseOAuthOutput(allOutput);
          if (parsed.deviceCode && parsed.verificationUri) {
            saveOAuthContext(absoluteHome, { ...parsed, updatedAt: new Date().toISOString() });
            finish(parsed);
          }
        };
        child.stdout.on('data', (d: any) => tryParse(d.toString()));
        child.stderr.on('data', (d: any) => tryParse(d.toString()));
        child.on('close', (code: any) => finish(undefined, new Error(`relogin 失败 (code=${code})。`)));
        child.on('error', (err: any) => finish(undefined, err));
        setTimeout(() => finish(undefined, new Error('等待授权信息超时（15秒）。')), 15000);
      }), 'clear');
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
    return res.json({ ...oauthResult });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 读取当前 OAuth 上下文
router.get('/accounts/:id/login-context', async (req: Request, res: Response) => {
  try {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: '账号不存在' });

    const ctx = readOAuthContext(path.resolve(account.homeDir));
    if (!ctx) return res.status(404).json({ error: '未找到授权上下文，请先点击"重新授权"。' });
    res.json(ctx);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// OAuth checklogin：用 device_code 确认授权完成
router.post('/accounts/:id/checklogin', async (req: Request, res: Response) => {
  try {
    const startedAt = Date.now();
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: '账号不存在' });

    const { deviceCode } = req.body;
    if (!deviceCode) return res.status(400).json({ error: 'deviceCode 不能为空' });

    let checkOutput = '';
    try {
      // saveBackup=true: checklogin 成功写入 credential 后立即在锁内备份，防止其他账号在锁释放前抢占
      const { stdout, stderr } = await runJimengCommand(
        `dreamina login checklogin --device_code=${deviceCode} --poll=${CHECKLOGIN_POLL_SECONDS}`,
        account.homeDir,
        true,  // saveBackup
        CHECKLOGIN_TIMEOUT_MS
      );
      checkOutput = stdout + stderr;
    } catch (e: any) {
      checkOutput = String(e.message || '');
      if (checkOutput.includes('authorization_pending') || checkOutput.includes('pending')) {
        return res.status(202).json({
          pending: true,
          elapsedMs: Date.now() - startedAt,
          message: '用户尚未在浏览器完成授权，请完成后再点击确认。',
        });
      }
      throw e;
    }

    console.log(`[Checklogin output]: ${checkOutput}`);

    try {
      const { stdout: creditOut } = await runJimengCommand('dreamina user_credit', account.homeDir, false, ACCOUNT_CHECK_TIMEOUT_MS);
      if (creditOut && creditOut.includes('credit')) {
        await prisma.jimengAccount.update({ where: { id: account.id }, data: { status: 'IDLE' } });
        return res.json({ success: true, output: creditOut, elapsedMs: Date.now() - startedAt });
      }
    } catch {}

    res.status(500).json({ error: `授权确认失败，请重试。输出: ${checkOutput.substring(0, 300)}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有账号
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const accounts = await prisma.jimengAccount.findMany({ orderBy: { createdAt: 'asc' } });
    const metrics = await getAccountTaskMetrics(accounts.map((account) => account.id));
    res.json(accounts.map((account) => ({ ...account, metrics: metrics.get(account.id) })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除账号实例（同时清理本地 homeDir 文件）
router.delete('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: '账号不存在' });
    const absoluteHome = assertInside(
      ACCOUNTS_ROOT,
      path.resolve(account.homeDir),
      'account homeDir is outside the allowed data/accounts folder'
    );

    // 先删 DB 记录
    await prisma.jimengAccount.delete({ where: { id: account.id } });

    // 再清理 homeDir（忽略错误，目录可能不存在）
    try {
      if (fs.existsSync(absoluteHome)) {
        fs.rmSync(absoluteHome, { recursive: true, force: true });
      }
    } catch (_) {}

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 测试连通性并获取余额 (依赖手册中的 `dreamina user_credit` 命令)
router.post('/accounts/:id/check', async (req: Request, res: Response) => {
  try {
    const startedAt = Date.now();
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: "账号不存在" });

    // 运行验活及查余额命令
    const { stdout } = await runJimengCommand('dreamina user_credit', account.homeDir, false, ACCOUNT_CHECK_TIMEOUT_MS);
    
    // 解析具体的算力数值 (CLI 返回的其实是 JSON，包含多种点数如 total_credit/vip_credit 等)
    let newBalance = account.creditBalance;
    try {
      // 尝试截取并解析可能存在的 JSON 块
      const jsonStr = stdout.substring(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
      const creditInfo = JSON.parse(jsonStr);
      if (creditInfo.total_credit !== undefined) {
        newBalance = creditInfo.total_credit; // 抓取真正的总点数
      }
    } catch (e) {
      // fallback 正则解析
      const match = stdout.match(/"total_credit"\s*:\s*(\d+)/); 
      if (match) newBalance = parseInt(match[1], 10);
    }

    // 能成功运行说明登录态是有效的，更新余额；但 NO_VIP 状态不自动恢复（需人工升级会员）
    const updatedAccount = await prisma.jimengAccount.update({
      where: { id: account.id },
      data: { status: account.status === 'NO_VIP' ? 'NO_VIP' : 'IDLE', creditBalance: newBalance, lastChecked: new Date() }
    });

    res.json({ success: true, raw: stdout, account: updatedAccount, elapsedMs: Date.now() - startedAt });
  } catch (error: any) {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    const updatedAccount = account
      ? await prisma.jimengAccount.update({
          where: { id: account.id },
          data: { status: 'ERROR', lastChecked: new Date() }
        })
      : null;

    res.status(500).json({
      error: `账号检测失败 (可能未授权或凭证已过期)：\n${error.message}`,
      account: updatedAccount,
    });
  }
});

router.get('/native/capabilities', async (_req: Request, res: Response) => {
  res.json(nativeCapabilities);
});

router.get('/native/sessions', async (req: Request, res: Response) => {
  try {
    const accountId = getScalar(req.query.accountId);
    const maxCount = parseIntParam(req.query.maxCount, 'maxCount', { min: 1, max: 100, defaultValue: 30 });
    const result = await runNativeCli(accountId, `dreamina session list -n ${maxCount}`);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.post('/native/sessions', async (req: Request, res: Response) => {
  try {
    const accountId = getScalar(req.body?.accountId);
    const name = validateSessionName(getScalar(req.body?.name), false);
    const command = name ? `dreamina session create ${shellQuote(name)}` : 'dreamina session create';
    const result = await runNativeCli(accountId, command);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.get('/native/sessions/search', async (req: Request, res: Response) => {
  try {
    const accountId = getScalar(req.query.accountId);
    const name = validateSessionName(getScalar(req.query.name), true);
    const result = await runNativeCli(accountId, `dreamina session search ${shellQuote(name)}`);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.put('/native/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const accountId = getScalar(req.body?.accountId);
    const sessionId = validateSessionId(getScalar(req.params.sessionId));
    const name = validateSessionName(getScalar(req.body?.name), true);
    const result = await runNativeCli(accountId, `dreamina session rename ${sessionId} ${shellQuote(name)}`);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.delete('/native/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const accountId = getScalar(req.body?.accountId || req.query.accountId);
    const sessionId = validateSessionId(getScalar(req.params.sessionId));
    const result = await runNativeCli(accountId, `dreamina session delete ${sessionId}`);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.get('/native/tasks', async (req: Request, res: Response) => {
  try {
    const accountId = getScalar(req.query.accountId);
    const limit = parseIntParam(req.query.limit, 'limit', { min: 1, max: 100, defaultValue: 20 });
    const offset = parseIntParam(req.query.offset, 'offset', { min: 0, max: 100000, defaultValue: 0 });
    const genStatus = getScalar(req.query.gen_status);
    const genTaskType = getScalar(req.query.gen_task_type);
    const submitId = getScalar(req.query.submit_id);

    const args = [`--limit=${limit}`, `--offset=${offset}`];
    if (genStatus) args.push(`--gen_status=${validateSafeToken(genStatus, 'gen_status', 40)}`);
    if (genTaskType) args.push(`--gen_task_type=${validateSafeToken(genTaskType, 'gen_task_type', 60)}`);
    if (submitId) args.push(`--submit_id=${validateSubmitId(submitId)}`);

    const result = await runNativeCli(accountId, `dreamina list_task ${args.join(' ')}`);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

router.get('/native/query-result', async (req: Request, res: Response) => {
  try {
    const accountId = getScalar(req.query.accountId);
    const submitId = validateSubmitId(getScalar(req.query.submit_id));
    const args = [`--submit_id=${submitId}`];
    let downloadDir: string | null = null;
    if (parseNativeDownloadFlag(req.query.download)) {
      downloadDir = getSafeDownloadDir(submitId, getScalar(req.query.downloadDirName));
      args.push(`--download_dir=${shellQuote(downloadDir)}`);
    }

    const result = await runNativeCli(
      accountId,
      `dreamina query_result ${args.join(' ')}`,
      downloadDir ? NATIVE_CLI_DOWNLOAD_TIMEOUT_MS : NATIVE_CLI_TIMEOUT_MS
    );
    res.json({ ...result, downloadDir });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

// 生成并分发一个新的 API KEY 用于客户端
router.post('/apikeys', async (req: Request, res: Response) => {
  const { owner, quota, boundAccountId } = req.body;
  const parsedQuota = quota === undefined || quota === null || quota === '' ? null : Number(quota);
  if (parsedQuota !== null && (!Number.isInteger(parsedQuota) || parsedQuota < 0)) {
    return res.status(400).json({ error: "quota must be a non-negative integer or empty" });
  }
  const key = 'sk-jm-' + randomBytes(24).toString('hex');
  
  const apikey = await prisma.apiKey.create({
    data: {
      key,
      owner: owner || 'unknown',
      quota: parsedQuota,
      boundAccountId: boundAccountId || null
    },
    include: { boundAccount: { select: { id: true, name: true } } }
  });

  res.json(apikey);
});

// 获取所有已生成的 API KEY
router.get('/apikeys', async (req: Request, res: Response) => {
  try {
    const apikeys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      include: { boundAccount: { select: { id: true, name: true } } }
    });
    const metrics = await getApiKeyTaskMetrics(apikeys.map((key) => key.id));
    res.json(apikeys.map((key) => {
      const usage = metrics.get(key.id) || { total: 0, today: 0, success: 0, failed: 0, processing: 0 };
      return { ...key, used: usage.total, usage };
    }));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 修改绑定账号
router.put('/apikeys/:id/rebind', async (req: Request, res: Response) => {
  try {
    const { boundAccountId } = req.body;
    const updated = await prisma.apiKey.update({
      where: { id: req.params.id as string },
      data: { boundAccountId: boundAccountId || null },
      include: { boundAccount: { select: { id: true, name: true } } }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 停用/启用 API KEY
router.put('/apikeys/:id/toggle', async (req: Request, res: Response) => {
  try {
    const apikey = await prisma.apiKey.findUnique({ where: { id: req.params.id as string } });
    if (!apikey) return res.status(404).json({ error: "API Key 不存在" });
    
    const updated = await prisma.apiKey.update({
      where: { id: req.params.id as string },
      data: { isActive: !apikey.isActive }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除 API KEY
router.delete('/apikeys/:id', async (req: Request, res: Response) => {
  try {
    const apikey = await prisma.apiKey.delete({
      where: { id: req.params.id as string }
    });
    res.json(apikey);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── 任务管理 ───────────────────────────────────────────────────────

// 查询任务列表（支持 status/apiKeyId/accountId 过滤，分页）
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const { status, accountId, prompt, error, type, model, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: any = {};
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;
    if (prompt) where.prompt = { contains: prompt };
    if (error) where.OR = [{ errorMsg: { contains: error } }, { pollErrorMsg: { contains: error } }];
    if (type) where.type = type;
    if (model) where.model = model;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          account: { select: { id: true, name: true } },
          apiKey: { select: { id: true, owner: true } }
        }
      })
    ]);

    res.json({ total, page: pageNum, limit: limitNum, tasks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取单个任务详情
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id as string },
      include: {
        account: { select: { id: true, name: true } },
        apiKey: { select: { id: true, owner: true } }
      }
    });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 强制失败任务（管理员手动干预卡住的任务）
router.post('/tasks/:id/fail', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const task = await prisma.task.findUnique({ where: { id: req.params.id as string } });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.status === 'SUCCESS') return res.status(400).json({ error: '任务已成功，无法标记失败' });

    const updated = await prisma.task.update({
      where: { id: req.params.id as string },
      data: {
        status: 'FAILED',
        errorMsg: reason || '管理员手动标记失败',
        pollErrorMsg: null
      }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 重置任务为 PROCESSING（允许重新轮询）
router.post('/tasks/:id/retry', async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id as string } });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (!task.jimengSubmitId) return res.status(400).json({ error: '任务没有 submit_id，无法重试' });

    const updated = await prisma.task.update({
      where: { id: req.params.id as string },
      data: { status: 'PROCESSING', errorMsg: null, pollErrorMsg: null }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
