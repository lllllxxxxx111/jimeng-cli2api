import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { runJimengCommand, DREAMINA_BIN, saveCredentialBackup, saveRegToken, withCredSwap, generateFreshCredential, deleteRegTokenBackup } from '../utils/cliRunner';
import path from 'path';
import { randomBytes } from 'crypto';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { adminAuth } from '../middleware/adminAuth';
import { collectAdminStats } from '../services/adminStats';

const router = Router();
const prisma = new PrismaClient();
const OAUTH_CONTEXT_FILE = '.dreamina_oauth_context.json';
const PROMPT_RISK_LIMIT = 12;
const CHECKLOGIN_POLL_SECONDS = 30;
const CHECKLOGIN_TIMEOUT_MS = 45000;
const ACCOUNT_CHECK_TIMEOUT_MS = 30000;
const NATIVE_CLI_TIMEOUT_MS = 60000;
const NATIVE_CLI_DOWNLOAD_TIMEOUT_MS = 1000 * 60 * 5;
const NATIVE_DOWNLOAD_ROOT = path.resolve(__dirname, '../../data/downloads');
const TASK_PREVIEW_ROOT = path.resolve(__dirname, '../../data/previews');
const ACCOUNTS_ROOT = path.resolve(__dirname, '../../data/accounts');
const SAFE_CLI_TOKEN = /^[A-Za-z0-9_.:-]+$/;
const SAFE_SUBMIT_ID = /^[A-Za-z0-9_-]+$/;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const adminConfigPath = path.resolve(__dirname, '../../data/admin.json');

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

const isValidAdminToken = (token: string) => {
  if (!token || !fs.existsSync(adminConfigPath)) return false;
  const config = JSON.parse(fs.readFileSync(adminConfigPath, 'utf8'));
  return token === String(config.token || '');
};

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
  const text = stdout.trim();
  if (!text) return null;

  const tryParse = (candidate: string) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  const spans = [
    { start: stdout.indexOf('['), end: stdout.lastIndexOf(']') },
    { start: stdout.indexOf('{'), end: stdout.lastIndexOf('}') },
  ]
    .filter(({ start, end }) => start >= 0 && end > start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  for (const { start, end } of spans) {
    const parsed = tryParse(stdout.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }

  return null;
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

const getSafePreviewDir = (taskId: string) => {
  const cleanName = taskId.replace(/[^A-Za-z0-9_.-]/g, '_');
  const target = path.resolve(TASK_PREVIEW_ROOT, cleanName);
  assertInside(TASK_PREVIEW_ROOT, target, 'preview directory is outside the allowed data/previews folder');
  fs.mkdirSync(target, { recursive: true });
  return target;
};

const findFirstDownloadedMediaPath = (value: any): string => {
  if (!value || typeof value !== 'object') return '';
  const stack = [value];
  while (stack.length) {
    const item = stack.shift();
    if (!item || typeof item !== 'object') continue;
    if (typeof item.path === 'string' && /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/i.test(item.path)) {
      return item.path;
    }
    for (const child of Object.values(item)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return '';
};

const streamLocalFile = (filePath: string, res: Response) => {
  const absolute = assertInside(TASK_PREVIEW_ROOT, path.resolve(filePath), 'preview file is outside the allowed data/previews folder');
  if (!fs.existsSync(absolute)) throw new Error('preview file was not created');
  const ext = path.extname(absolute).toLowerCase();
  const contentType = ext === '.mp4' ? 'video/mp4'
    : ext === '.mov' ? 'video/quicktime'
    : ext === '.webm' ? 'video/webm'
    : ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(fs.statSync(absolute).size));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(absolute).pipe(res);
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
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[，。！？、；：“”‘’（）【】《》,.!?;:"'()[\]{}<>]/g, ' ')
    .trim()
    .toLowerCase();
}

function promptRiskTokens(value: string) {
  const normalized = normalizePromptForRisk(value);
  const tokens = new Set<string>();
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const word of words) {
    tokens.add(word);
    if (/[\u3400-\u9fff]/u.test(word)) {
      for (let i = 0; i < word.length - 1; i += 1) {
        tokens.add(word.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

function setOverlapScore(leftTokens: Set<string>, rightTokens: Set<string>) {
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union ? shared / union : 0;
  const coverage = shared / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, coverage * 0.82);
}

function promptSimilarity(a: string, b: string) {
  const left = normalizePromptForRisk(a);
  const right = normalizePromptForRisk(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }

  return setOverlapScore(promptRiskTokens(left), promptRiskTokens(right));
}

function shortReason(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function summarizeRiskReasons(matches: Array<{ reason: string }>) {
  const counts = new Map<string, number>();
  for (const item of matches) {
    const reason = shortReason(item.reason);
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

function riskRecommendations(level: string, matches: any[]) {
  if (level === 'clear') {
    return [
      '历史失败库暂未命中相似提示词；仍建议先用低成本参数试跑。',
      '提交前确认模型、任务类型和账号额度是否匹配。',
    ];
  }
  const actions = [
    '先打开相似失败记录，确认失败原因是不是提示词本身。',
    '改写高风险表达，降低敏感词、绝对化描述和可能违规的主体描述。',
    '保留核心画面目标，拆掉过长修饰词后再提交。',
  ];
  if (matches.length >= 3) actions.unshift('命中多条历史失败记录，建议不要直接提交原提示词。');
  return actions;
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

router.get('/tasks/:id/content', async (req: Request, res: Response) => {
  try {
    const token = getScalar(req.query.token);
    const authHeader = String(req.headers.authorization || '');
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!isValidAdminToken(token || bearerToken)) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const task = await prisma.task.findUnique({
      where: { id: req.params.id as string },
      include: { account: true },
    });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.status !== 'SUCCESS' || !task.resultUrl) {
      return res.status(409).json({ error: '任务尚未成功或没有结果 URL' });
    }

    try {
      const upstream = await axios.get(task.resultUrl, {
        responseType: 'stream',
        timeout: 60000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://jimeng.jianying.com/' },
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const contentType = String(upstream.headers['content-type'] || 'application/octet-stream');
      const contentLength = upstream.headers['content-length'] ? String(upstream.headers['content-length']) : '';
      res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      res.setHeader('Cache-Control', 'private, no-store');
      upstream.data.pipe(res);
      return;
    } catch {}

    if (!task.account?.homeDir || !task.jimengSubmitId) {
      return res.status(502).json({ error: '远端结果 URL 不可用，且任务缺少账号或 submit_id，无法重新下载' });
    }
    const previewDir = getSafePreviewDir(task.id);
    const command = `dreamina query_result --submit_id=${validateSubmitId(task.jimengSubmitId)} --download_dir=${shellQuote(previewDir)}`;
    const { stdout } = await runJimengCommand(command, task.account.homeDir, false, NATIVE_CLI_DOWNLOAD_TIMEOUT_MS);
    const parsed = parseCliJson(stdout);
    const localPath = findFirstDownloadedMediaPath(parsed);
    if (!localPath) {
      return res.status(502).json({ error: '已重新查询即梦结果，但没有拿到可下载的媒体文件路径' });
    }
    streamLocalFile(localPath, res);
  } catch (error: any) {
    const status = error.response?.status || 502;
    res.status(status).json({
      error: '结果文件代理失败，远端签名链接可能已过期或当前网络无法访问',
      detail: String(error.message || error).slice(0, 300),
    });
  }
});

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

    const scored = rows
      .map((row) => ({
        ...row,
        similarity: promptSimilarity(prompt, row.prompt),
        reason: row.errorMsg || row.pollErrorMsg || '',
      }));
    const matches = scored
      .filter((row) => row.similarity >= 0.28)
      .sort((a, b) => b.similarity - a.similarity || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, PROMPT_RISK_LIMIT);

    const highest = matches[0]?.similarity || 0;
    const level = highest >= 0.78 || matches.length >= 4 ? 'high' : highest >= 0.48 || matches.length >= 2 ? 'medium' : matches.length > 0 ? 'low' : 'clear';
    const suggestion = level === 'clear'
      ? '历史失败记录中未发现相似提示词；仍建议先用低成本参数试跑。'
      : level === 'high'
        ? '命中多条或高度相似的失败记录，不建议直接提交原提示词。'
        : '发现相似失败记录，建议先复核失败原因并改写提示词。';

    res.json({
      prompt,
      model: model || null,
      type: type || null,
      level,
      highestSimilarity: highest,
      matchedCount: matches.length,
      reviewedCount: rows.length,
      topReasons: summarizeRiskReasons(matches),
      recommendations: riskRecommendations(level, matches),
      thresholds: { low: 0.28, medium: 0.48, high: 0.78 },
      matches,
      suggestion,
      checkedAt: new Date().toISOString(),
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

function parseCreditBalance(stdout: string, fallback: number): number {
  try {
    const jsonStr = stdout.substring(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
    const creditInfo = JSON.parse(jsonStr);
    if (creditInfo.total_credit !== undefined) return creditInfo.total_credit;
  } catch {}
  const match = stdout.match(/"total_credit"\s*:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : fallback;
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
    deleteRegTokenBackup(absoluteHome);
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
            const result = { ...parsed, rawOutput: allOutput.trim() };
            saveOAuthContext(absoluteHome, { ...result, updatedAt: new Date().toISOString() });
            finish(result);
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
    deleteRegTokenBackup(absoluteHome);
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
            const result = { ...parsed, rawOutput: allOutput.trim() };
            saveOAuthContext(absoluteHome, { ...result, updatedAt: new Date().toISOString() });
            finish(result);
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
        CHECKLOGIN_TIMEOUT_MS,
        undefined,
        'none'
      );
      checkOutput = stdout + stderr;
    } catch (e: any) {
      checkOutput = String(e.message || '');
      if (
        checkOutput.includes('authorization_pending') ||
        checkOutput.includes('pending') ||
        checkOutput.includes('等待登录超时')
      ) {
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

// 手动接管：用户在同一台服务器/同一 Windows 用户下手动完成 CLI checklogin 后，
// 从当前本机 CLI 登录态导入 token/credential，并用 user_credit 验证。
router.post('/accounts/:id/import-current-login', async (req: Request, res: Response) => {
  try {
    const startedAt = Date.now();
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: '账号不存在' });

    const absoluteHome = path.resolve(account.homeDir);
    fs.mkdirSync(absoluteHome, { recursive: true });

    const manualOutput = typeof req.body?.manualOutput === 'string' ? req.body.manualOutput.trim() : '';
    if (manualOutput) {
      fs.writeFileSync(
        path.join(absoluteHome, '.dreamina_manual_login_output.txt'),
        manualOutput.slice(0, 50000),
        'utf8'
      );
    }

    saveCredentialBackup(absoluteHome);
    await saveRegToken(absoluteHome);

    const { stdout } = await runJimengCommand('dreamina user_credit', account.homeDir, false, ACCOUNT_CHECK_TIMEOUT_MS);
    const newBalance = parseCreditBalance(stdout, account.creditBalance);

    saveCredentialBackup(absoluteHome);
    await saveRegToken(absoluteHome);

    const updatedAccount = await prisma.jimengAccount.update({
      where: { id: account.id },
      data: {
        status: account.status === 'NO_VIP' ? 'NO_VIP' : 'IDLE',
        creditBalance: newBalance,
        lastChecked: new Date(),
      },
    });

    res.json({
      success: true,
      account: updatedAccount,
      raw: stdout,
      manualOutputSaved: Boolean(manualOutput),
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    const updatedAccount = account
      ? await prisma.jimengAccount.update({
          where: { id: account.id },
          data: { status: 'ERROR', lastChecked: new Date() },
        })
      : null;

    res.status(500).json({
      error: `导入当前 CLI 登录态失败：\n${error.message}`,
      account: updatedAccount,
    });
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
    
    const newBalance = parseCreditBalance(stdout, account.creditBalance);

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
const taskToolWhere = (tool: string) => {
  if (tool === 'image_generation') return { OR: [{ toolType: 'image_generation' }, { type: { in: ['text2image', 'image2image'] } }] };
  if (tool === 'dreamina_video_generation' || tool === 'video_generation') {
    return { OR: [{ toolType: { in: ['dreamina_video_generation', 'video_generation'] } }, { type: { in: ['text2video', 'image2video', 'frames2video', 'multiframe2video', 'multimodal2video'] } }] };
  }
  if (tool === 'image_upscale') return { OR: [{ toolType: 'image_upscale' }, { type: 'image_upscale' }] };
  return { toolType: tool };
};

router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const { status, accountId, prompt, error, type, model, tool, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: any = {};
    const and: any[] = [];
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;
    if (prompt) where.prompt = { contains: prompt };
    if (error) and.push({ OR: [{ errorMsg: { contains: error } }, { pollErrorMsg: { contains: error } }] });
    if (type) where.type = type;
    if (model) where.model = model;
    if (tool) and.push(taskToolWhere(tool));
    if (and.length) where.AND = and;

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

// 查询即梦侧实时状态。CLI 不提供取消接口，这里只读官方状态和队列信息。
router.get('/tasks/:id/live', async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id as string },
      include: { account: true },
    });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (!task.account?.homeDir || !task.jimengSubmitId) {
      return res.status(400).json({ error: '任务缺少账号或 submit_id，无法查询即梦官方状态' });
    }

    const { stdout, stderr } = await runJimengCommand(
      `dreamina query_result --submit_id=${validateSubmitId(task.jimengSubmitId)}`,
      task.account.homeDir,
      false,
      NATIVE_CLI_TIMEOUT_MS
    );
    const parsed = parseCliJson(stdout);
    res.json({
      success: true,
      stdout,
      stderr,
      parsed,
      gen_status: parsed?.gen_status || null,
      queue_info: parsed?.queue_info || null,
      credit_count: parsed?.credit_count ?? null,
      elapsedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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

// 停止本地跟踪：只更新本地任务状态，不取消即梦侧已提交任务。
router.post('/tasks/:id/stop-tracking', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const task = await prisma.task.findUnique({ where: { id: req.params.id as string } });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.status === 'SUCCESS') return res.status(400).json({ error: '任务已成功，不能停止本地跟踪' });

    const updated = await prisma.task.update({
      where: { id: req.params.id as string },
      data: {
        status: 'FAILED',
        errorMsg: reason || '管理员停止本地跟踪；不代表即梦侧已取消生成',
        pollErrorMsg: null
      }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy endpoint kept for old frontend builds. Prefer /stop-tracking.
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
