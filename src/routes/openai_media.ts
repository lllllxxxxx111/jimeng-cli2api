import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { accountService } from '../services/accountService';
import { runJimengCommand } from '../utils/cliRunner';
import { saveTempFile, cleanupTempFile } from '../utils/fileHandler';
import multer from 'multer';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const shellQuote = (value: string): string => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function buildSessionParam(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  const session = Number(raw);
  if (!Number.isInteger(session) || session < 0) {
    const error = new Error('session must be a non-negative integer');
    (error as any).statusCode = 400;
    throw error;
  }
  return `--session=${session}`;
}

const apiKeyAuth = async (req: Request, res: Response, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: { message: 'Missing Authorization header' } });
  const token = authHeader.split(' ')[1];
  const apiKey = await prisma.apiKey.findUnique({ where: { key: token, isActive: true as any } });
  if (!apiKey) return res.status(401).json({ error: { message: 'Invalid API Key' } });
  (req as any).apiUserId = apiKey.id;
  (req as any).apiBoundAccountId = apiKey.boundAccountId ?? null;
  next();
};

const dispatchJimengTask = async (
  req: Request, 
  res: Response, 
  type: 'text2image' | 'text2video' | 'image2image' | 'image2video',
  commandBuilder: (tempFilePath: string | null) => string,
  tempFilePath: string | null = null
) => {
    const account = await accountService.getIdleAccount((req as any).apiBoundAccountId);
    if (!account) {
      if (tempFilePath) cleanupTempFile(tempFilePath);
      return res.status(503).json({ error: { message: 'All Dreamina accounts are busy or out of credits. Please try again later.' } });
    }

    const command = commandBuilder(tempFilePath);
    console.log(`[Jimeng Dispatcher] Account: ${account.name} -> Executing: ${command}`);
    
    let dbTask;
    try {
      const apiKeyId = String((req as any).apiUserId);
      dbTask = await prisma.$transaction(async (tx) => {
        const apiKey = await tx.apiKey.findUnique({ where: { id: apiKeyId } });
        if (!apiKey) {
          const error: any = new Error('Invalid API Key');
          error.status = 401;
          throw error;
        }

        const actualUsed = await tx.task.count({ where: { apiKeyId } });
        if (apiKey.quota !== null && actualUsed >= apiKey.quota) {
          const error: any = new Error('API Key quota exceeded');
          error.status = 429;
          throw error;
        }

        const task = await tx.task.create({
          data: {
            apiKeyId,
            accountId: account.id,
            type,
            prompt: req.body.prompt || req.body.messages?.[0]?.content || "Generating from image",
          }
        });
        await tx.apiKey.update({
          where: { id: apiKeyId },
          data: { used: actualUsed + 1 },
        });
        return task;
      });
    } catch (usageError: any) {
      await accountService.releaseAccount(account.id, 'IDLE');
      if (tempFilePath) cleanupTempFile(tempFilePath);
      return res.status(usageError.status || 500).json({ error: { message: usageError.message } });
    }

    let submitId = "";
    try {
      const { stdout } = await runJimengCommand(command, account.homeDir);
      
      let logId: string | null = null;
      try {
        const jsonStr = stdout.substring(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
        const result = JSON.parse(jsonStr);
        if (result.submit_id) submitId = result.submit_id;
        else if (result.task_id) submitId = result.task_id;
        else if (result.data?.submit_id) submitId = result.data.submit_id;
        logId = result.logid || result.log_id || result.data?.logid || null;
      } catch (parseErr) {}

      if (!submitId) {
        const idMatch = stdout.match(/(?:submit_id|task_id|tid|id)["':\s=]+([a-zA-Z0-9_\-]+)/i);
        if (idMatch && idMatch[1]) submitId = idMatch[1];
        else {
           const plainMatch = stdout.match(/\b([a-fA-F0-9]{16})\b/);
           if (plainMatch && plainMatch[1]) submitId = plainMatch[1];
           else throw new Error("Cannot find submit_id in CLI output.\nRaw: " + stdout.substring(0, 500));
        }
      }
      if (!logId) {
        const logMatch = stdout.match(/logid["':\s=]+([a-zA-Z0-9_\-]+)/i);
        if (logMatch && logMatch[1]) logId = logMatch[1];
      }

      await prisma.task.update({
        where: { id: dbTask.id },
        data: { status: 'PROCESSING', jimengSubmitId: submitId, jimengLogId: logId }
      });
      
    } catch (cmdErr: any) {
      await prisma.task.update({
         where: { id: dbTask.id },
         data: { status: 'FAILED', errorMsg: cmdErr.message }
      });
      const isNoVip = cmdErr.message.includes('高级会员') || cmdErr.message.includes('vip') || cmdErr.message.includes('VIP') || cmdErr.message.includes('member');
      await accountService.releaseAccount(account.id, isNoVip ? 'NO_VIP' : 'ERROR');
      if (tempFilePath) cleanupTempFile(tempFilePath);
      return res.status(500).json({ error: { message: "Jimeng CLI failed: " + cmdErr.message } });
    }

    await accountService.releaseAccount(account.id, 'IDLE');
    if (tempFilePath) cleanupTempFile(tempFilePath);

    return res.json({ id: dbTask.id, status: "processing", submit_id: submitId });
};

router.post('/jimeng/image2video', apiKeyAuth, upload.single('image'), async (req: Request, res: Response) => {
  try {
    const prompt = req.body.prompt;
    if (!prompt) return res.status(400).json({ error: { message: "prompt is required" } });
    
    let tempFilePath: string | null = null;
    if (req.file) {
      tempFilePath = await saveTempFile(req.file.buffer, '.png');
    } 
    else if (req.body.image_url) {
      tempFilePath = await saveTempFile(req.body.image_url);
    }
    
    if (!tempFilePath) return res.status(400).json({ error: { message: "An input image is required for image2video" } });

    const sessionParam = buildSessionParam(req.body.session);
    const cmdBuilder = (localPath: string | null) => 
        `dreamina image2video --image=${shellQuote(localPath || '')} --prompt=${shellQuote(prompt)} --duration=5 ${sessionParam} --poll=0`;

    return await dispatchJimengTask(req, res, 'image2video', cmdBuilder, tempFilePath);

  } catch (err: any) {
    return res.status(err.statusCode || err.status || 500).json({ error: { message: err.message } });
  }
});

export default router;
