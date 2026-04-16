import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { runJimengCommand, DREAMINA_BIN } from '../utils/cliRunner';
import path from 'path';
import { randomBytes } from 'crypto';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { adminAuth } from '../middleware/adminAuth';

const router = Router();

router.post('/sys/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '密码不能为空' });
  const configPath = path.resolve(__dirname, '../../data/admin.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  const match = await bcrypt.compare(password, config.password);
  if (match) {
    const token = 'admin_token_' + Date.now();
    config.token = token;
    fs.writeFileSync(configPath, JSON.stringify(config));
    return res.json({ token });
  }
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
    config.token = 'admin_token_' + Date.now(); // force relogin
    fs.writeFileSync(configPath, JSON.stringify(config));
    return res.json({ success: true, message: '密码修改成功，请重新登录' });
  }
  res.status(401).json({ error: '旧密码错误' });
});

router.get('/sys/check', adminAuth, (req, res) => res.json({ ok: true }));

// Apply middleware to subsequent routes
router.use(adminAuth);


const prisma = new PrismaClient();

const LOGIN_CONTEXT_FILE = '.dreamina_login_context.json';

function extractRandomSecretKey(authUrl: string): string | null {
  try {
    return new URL(authUrl).searchParams.get('random_secret_key');
  } catch {
    return null;
  }
}

function buildImportUrl(randomSecretKey: string): string {
  return `https://jimeng.jianying.com/dreamina/cli/v1/dreamina_cli_login?aid=513695&random_secret_key=${randomSecretKey}&web_version=7.5.0`;
}

function saveLoginContext(accountHomeDir: string, authUrl: string) {
  const randomSecretKey = extractRandomSecretKey(authUrl);
  if (!randomSecretKey) return null;

  const loginContext = {
    authUrl,
    randomSecretKey,
    importUrl: buildImportUrl(randomSecretKey),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(accountHomeDir, LOGIN_CONTEXT_FILE), JSON.stringify(loginContext, null, 2), 'utf8');
  return loginContext;
}

function readLoginContext(accountHomeDir: string) {
  const filePath = path.join(accountHomeDir, LOGIN_CONTEXT_FILE);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// 添加新即梦账号并触发登录
router.post('/accounts/login', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  try {
    // 1. 为新账号创建一个独立的本地文件夹存放其特定的 ~/.dreamina_cli
    const homeDir = path.resolve(__dirname, `../../data/accounts/${name}_${Date.now()}`);
    if (!fs.existsSync(homeDir)) {
      fs.mkdirSync(homeDir, { recursive: true });
    }

    // 2. 存入数据库
    const account = await prisma.jimengAccount.create({
      data: { name, homeDir, status: 'IDLE', creditBalance: 0 }
    });

    // 3. 执行 login --debug。由于是交互式，我们希望捕获 debug 输出用于让用户在前端扫码
    // 注意：如果 login 是完全阻塞的命令行 UI，我们需要在子进程 stdout 流上读出链接直接返回，而不是等待子进程结束
    // 但是这里简化假设用 `--debug` 它会把授权链接打印出来
    
    const { spawn } = require('child_process');
    const absoluteHome = path.resolve(account.homeDir);
    const env = { ...process.env, HOME: absoluteHome, USERPROFILE: absoluteHome, APPDATA: absoluteHome, LOCALAPPDATA: absoluteHome };
    
    // 优先使用项目 bin/ 内的可执行文件
    const child = spawn(DREAMINA_BIN, ['login', '--debug'], { env, shell: false, windowsHide: true });
    let responded = false;

    child.stdout.on('data', (data: any) => {
      const output = data.toString();
      console.log(`[Jimeng Login Stdout]:\n${output}`);
      // 只要捕获到链接，立刻给前端发送响应去弹窗，但！子进程不会被关掉，它会继续在后台等你扫码完成！
      if (!responded) {
        const linkMatch = output.match(/https:\/\/jimeng\.jianying\.com[^\s|<>"'\\]+/i);
        if (linkMatch) {
          const loginContext = saveLoginContext(absoluteHome, linkMatch[0]);
          responded = true;
          res.json({ account, authUrl: linkMatch[0], importUrl: loginContext?.importUrl || null, rawStdout: output });
        }
      }
    });

    child.stderr.on('data', (data: any) => {
      console.log(`[Jimeng Login Stderr]:\n${data.toString()}`);
    });

    child.on('close', (code: any) => {
      if (!responded) {
        responded = true;
        res.status(500).json({ error: `CLI 进程直接退出了 (状态码: ${code})。系统可能无法识别 'dreamina' 命令，请确保你已经**彻底关闭并重新启动了**运行后端的那个终端。` });
      }
    });

    // 10秒超时保护
    setTimeout(() => {
      if (!responded) {
        responded = true;
        res.status(500).json({ error: '等待 CLI 抛出登录链接超时了（10秒）。请查看 Node.js 后端终端获取详细情况。' });
      }
    }, 10000);

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 重新登录或完成现有的即梦账号绑定
router.post('/accounts/:id/relogin', async (req: Request, res: Response) => {
  try {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: "账号不存在" });

    const { spawn } = require('child_process');
    const absoluteHome = path.resolve(account.homeDir);

    const env = { ...process.env, HOME: absoluteHome, USERPROFILE: absoluteHome, APPDATA: absoluteHome, LOCALAPPDATA: absoluteHome };
    // 直接走 debug 模式：即使本地回调端口冲突，也能拿到 manual import 链接
    const child = spawn(DREAMINA_BIN, ['relogin', '--debug'], { env, shell: false, windowsHide: true });
    let responded = false;
    let allOutput = '';

    const tryRespondByOutput = (chunk: string) => {
      allOutput += chunk;
      const linkMatch = allOutput.match(/https:\/\/jimeng\.jianying\.com[^\s|<>"'\\]+/i);
      if (!responded && linkMatch) {
        const loginContext = saveLoginContext(absoluteHome, linkMatch[0]);
        responded = true;
        res.json({
          authUrl: linkMatch[0],
          importUrl: loginContext?.importUrl || null,
          mode: 'manual-import-preferred',
          message: '若提示端口占用，请直接使用 JSON 导入方式完成登录。'
        });
      }
    };

    child.stdout.on('data', (data: any) => {
      const output = data.toString();
      console.log(`[Relogin Stdout]: ${output}`);
      tryRespondByOutput(output);
    });

    child.stderr.on('data', (data: any) => {
      const output = data.toString();
      console.log(`[Relogin Stderr]: ${output}`);
      tryRespondByOutput(output);
    });

    child.on('close', (code: any) => {
      console.log(`[Relogin] CLI exited with code ${code}`);
      if (!responded) {
        responded = true;
        res.status(500).json({
          error: `relogin 失败（code=${code}）。请改用 JSON 导入登录。`,
          rawOutput: allOutput
        });
      }
    });

    child.on('error', (err: any) => {
      if (!responded) {
        responded = true;
        res.status(500).json({ error: `无法启动 CLI: ${err.message}` });
      }
    });

    setTimeout(() => {
      if (!responded) {
        responded = true;
        res.status(500).json({ error: '等待登录链接超时（20秒）。请点击 JSON 导入并用当前账号专用链接完成授权。' });
      }
    }, 20000);

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/accounts/:id/login-context', async (req: Request, res: Response) => {
  try {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: '账号不存在' });

    const loginContext = readLoginContext(path.resolve(account.homeDir));
    if (!loginContext) {
      return res.status(404).json({ error: '未找到该账号最近一次登录上下文，请先点击“重新授权”或“部署新账号实例”。' });
    }

    res.json(loginContext);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// JSON 导入登录态
router.post('/accounts/:id/import-login', async (req: Request, res: Response) => {
  try {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: "账号不存在" });

    const { loginJson } = req.body;
    if (!loginJson) return res.status(400).json({ error: "loginJson 不能为空" });

    // 兼容从 txt 粘贴时混入的 BOM/前后说明文字/空白
    let parsed: any;
    try {
      const rawText = typeof loginJson === 'string' ? loginJson : JSON.stringify(loginJson);
      const cleanedText = rawText.replace(/^\uFEFF/, '').trim();
      const first = cleanedText.indexOf('{');
      const last = cleanedText.lastIndexOf('}');
      if (first === -1 || last === -1 || last <= first) {
        return res.status(400).json({ error: "loginJson 不是有效 JSON 对象" });
      }
      const jsonBody = cleanedText.slice(first, last + 1);
      parsed = JSON.parse(jsonBody);
    } catch {
      return res.status(400).json({ error: "loginJson 格式不合法" });
    }

    if (!parsed || !parsed.auth_token) {
      return res.status(400).json({ error: "loginJson 缺少 auth_token 字段，请确认复制的是 dreamina_cli_login 的完整响应 body" });
    }

    const absoluteHome = path.resolve(account.homeDir);
    const tmpFile = path.join(absoluteHome, 'dreamina-login-import.json');
    // 用标准 JSON 重写，避免 txt 粘贴导致的隐藏字符污染
    const jsonStr = JSON.stringify(parsed);
    fs.writeFileSync(tmpFile, jsonStr, 'utf8');

    try {
      const { stdout, stderr } = await runJimengCommand(
        `dreamina import_login_response --file "${tmpFile}"`,
        account.homeDir
      );
      fs.unlinkSync(tmpFile);
      const output = stdout + stderr;
      // 更新账号状态为 IDLE
      await prisma.jimengAccount.update({ where: { id: account.id }, data: { status: 'IDLE' } });
      res.json({ success: true, output });
    } catch (e: any) {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      const msg = String(e.message || '');
      if (msg.includes('auth_token cannot be decrypted by local random_secret_key')) {
        const ctx = readLoginContext(absoluteHome);
        return res.status(500).json({
          error: '导入失败：当前 JSON 与本账号这次登录的 random_secret_key 不匹配。请不要再次点击“重新授权”，直接使用当前弹窗中的“当前账号专用导入链接”重新获取 JSON 后立刻导入。',
          importUrl: ctx?.importUrl || null,
        });
      }
      res.status(500).json({ error: e.message });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有账号
router.get('/accounts', async (req: Request, res: Response) => {
  const accounts = await prisma.jimengAccount.findMany();
  res.json(accounts);
});

// 测试连通性并获取余额 (依赖手册中的 `dreamina user_credit` 命令)
router.post('/accounts/:id/check', async (req: Request, res: Response) => {
  try {
    const account = await prisma.jimengAccount.findUnique({ where: { id: req.params.id as string } });
    if (!account) return res.status(404).json({ error: "账号不存在" });

    // 运行验活及查余额命令
    const { stdout } = await runJimengCommand('dreamina user_credit', account.homeDir);
    
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

    res.json({ success: true, raw: stdout, account: updatedAccount });
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

// 生成并分发一个新的 API KEY 用于客户端
router.post('/apikeys', async (req: Request, res: Response) => {
  const { owner, quota, boundAccountId } = req.body;
  const key = 'sk-jm-' + randomBytes(24).toString('hex');
  
  const apikey = await prisma.apiKey.create({
    data: {
      key,
      owner: owner || 'unknown',
      quota: quota ? parseInt(quota) : null,
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
    res.json(apikeys);
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

export default router;
