"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const accountService_1 = require("../services/accountService");
const cliRunner_1 = require("../utils/cliRunner");
const fileHandler_1 = require("../utils/fileHandler");
const multer_1 = __importDefault(require("multer"));
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const shellQuote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
function buildSessionParam(raw) {
    if (raw === undefined || raw === null || raw === '')
        return '';
    const session = Number(raw);
    if (!Number.isInteger(session) || session < 0) {
        const error = new Error('session must be a non-negative integer');
        error.statusCode = 400;
        throw error;
    }
    return `--session=${session}`;
}
const apiKeyAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
        return res.status(401).json({ error: { message: 'Missing Authorization header' } });
    const token = authHeader.split(' ')[1];
    const apiKey = await prisma.apiKey.findUnique({ where: { key: token, isActive: true } });
    if (!apiKey)
        return res.status(401).json({ error: { message: 'Invalid API Key' } });
    req.apiUserId = apiKey.id;
    req.apiBoundAccountId = apiKey.boundAccountId ?? null;
    next();
};
const dispatchJimengTask = async (req, res, type, commandBuilder, tempFilePath = null) => {
    const account = await accountService_1.accountService.getIdleAccount(req.apiBoundAccountId);
    if (!account) {
        if (tempFilePath)
            (0, fileHandler_1.cleanupTempFile)(tempFilePath);
        return res.status(503).json({ error: { message: 'All Dreamina accounts are busy or out of credits. Please try again later.' } });
    }
    const command = commandBuilder(tempFilePath);
    console.log(`[Jimeng Dispatcher] Account: ${account.name} -> Executing: ${command}`);
    let dbTask;
    try {
        const apiKeyId = String(req.apiUserId);
        dbTask = await prisma.$transaction(async (tx) => {
            const apiKey = await tx.apiKey.findUnique({ where: { id: apiKeyId } });
            if (!apiKey) {
                const error = new Error('Invalid API Key');
                error.status = 401;
                throw error;
            }
            const actualUsed = await tx.task.count({ where: { apiKeyId } });
            if (apiKey.quota !== null && actualUsed >= apiKey.quota) {
                const error = new Error('API Key quota exceeded');
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
    }
    catch (usageError) {
        await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
        if (tempFilePath)
            (0, fileHandler_1.cleanupTempFile)(tempFilePath);
        return res.status(usageError.status || 500).json({ error: { message: usageError.message } });
    }
    let submitId = "";
    try {
        const { stdout } = await (0, cliRunner_1.runJimengCommand)(command, account.homeDir);
        let logId = null;
        try {
            const jsonStr = stdout.substring(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
            const result = JSON.parse(jsonStr);
            if (result.submit_id)
                submitId = result.submit_id;
            else if (result.task_id)
                submitId = result.task_id;
            else if (result.data?.submit_id)
                submitId = result.data.submit_id;
            logId = result.logid || result.log_id || result.data?.logid || null;
        }
        catch (parseErr) { }
        if (!submitId) {
            const idMatch = stdout.match(/(?:submit_id|task_id|tid|id)["':\s=]+([a-zA-Z0-9_\-]+)/i);
            if (idMatch && idMatch[1])
                submitId = idMatch[1];
            else {
                const plainMatch = stdout.match(/\b([a-fA-F0-9]{16})\b/);
                if (plainMatch && plainMatch[1])
                    submitId = plainMatch[1];
                else
                    throw new Error("Cannot find submit_id in CLI output.\nRaw: " + stdout.substring(0, 500));
            }
        }
        if (!logId) {
            const logMatch = stdout.match(/logid["':\s=]+([a-zA-Z0-9_\-]+)/i);
            if (logMatch && logMatch[1])
                logId = logMatch[1];
        }
        await prisma.task.update({
            where: { id: dbTask.id },
            data: { status: 'PROCESSING', jimengSubmitId: submitId, jimengLogId: logId }
        });
    }
    catch (cmdErr) {
        await prisma.task.update({
            where: { id: dbTask.id },
            data: { status: 'FAILED', errorMsg: cmdErr.message }
        });
        const isNoVip = cmdErr.message.includes('高级会员') || cmdErr.message.includes('vip') || cmdErr.message.includes('VIP') || cmdErr.message.includes('member');
        await accountService_1.accountService.releaseAccount(account.id, isNoVip ? 'NO_VIP' : 'ERROR');
        if (tempFilePath)
            (0, fileHandler_1.cleanupTempFile)(tempFilePath);
        return res.status(500).json({ error: { message: "Jimeng CLI failed: " + cmdErr.message } });
    }
    await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
    if (tempFilePath)
        (0, fileHandler_1.cleanupTempFile)(tempFilePath);
    return res.json({ id: dbTask.id, status: "processing", submit_id: submitId });
};
router.post('/jimeng/image2video', apiKeyAuth, upload.single('image'), async (req, res) => {
    try {
        const prompt = req.body.prompt;
        if (!prompt)
            return res.status(400).json({ error: { message: "prompt is required" } });
        let tempFilePath = null;
        if (req.file) {
            tempFilePath = await (0, fileHandler_1.saveTempFile)(req.file.buffer, '.png');
        }
        else if (req.body.image_url) {
            tempFilePath = await (0, fileHandler_1.saveTempFile)(req.body.image_url);
        }
        if (!tempFilePath)
            return res.status(400).json({ error: { message: "An input image is required for image2video" } });
        const sessionParam = buildSessionParam(req.body.session);
        const cmdBuilder = (localPath) => `dreamina image2video --image=${shellQuote(localPath || '')} --prompt=${shellQuote(prompt)} --duration=5 ${sessionParam} --poll=0`;
        return await dispatchJimengTask(req, res, 'image2video', cmdBuilder, tempFilePath);
    }
    catch (err) {
        return res.status(err.statusCode || err.status || 500).json({ error: { message: err.message } });
    }
});
exports.default = router;
//# sourceMappingURL=openai_media.js.map