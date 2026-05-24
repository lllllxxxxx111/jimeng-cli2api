"use strict";
/**
 * @file openai.ts
 * @description 处理 OpenAI 标准的生图、生视频路由接口。包含复杂的视频流和多媒体帧校验逻辑，以及 ffmpeg 探测。
 * @author XiaoYue <43854695@qq.com>
 * @license MIT
 * @date 2026-04-17
 *
 * [! 防屎山规范 !]
 * - 绝对不要在此文件写死任何 API KEY 或硬编码文件路径！
 * - 所有的多媒体时长、帧率校验规则集中在此文件的顶部常量中管理。
 * - 使用 ffprobe 进行实际的多媒体探测，不依赖文件后缀做武断判断。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const accountService_1 = require("../services/accountService");
const cliRunner_1 = require("../utils/cliRunner");
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const upload = (0, multer_1.default)({ dest: 'temp_uploads/' });
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const MB = 1024 * 1024;
const IMAGE_MAX_BYTES = 30 * MB;
const VIDEO_MAX_BYTES = 50 * MB;
const AUDIO_MAX_BYTES = 15 * MB;
const REQUEST_MAX_BYTES = 64 * MB;
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov']);
const AUDIO_EXTS = new Set(['.wav', '.mp3']);
const normalizeVideoModelVersion = (raw) => {
    const model = (raw || '').trim();
    const map = {
        '3.0_fast': '3.0fast',
        '3.0_pro': '3.0pro',
        '3.5_pro': '3.5pro',
    };
    return map[model] || model;
};
const TEXT2VIDEO_MODELS = new Set([
    'seedance2.0',
    'seedance2.0fast',
    'seedance2.0_vip',
    'seedance2.0fast_vip',
]);
const IMAGE2VIDEO_MODELS = new Set([
    '3.0',
    '3.0fast',
    '3.0pro',
    '3.5pro',
    'seedance2.0',
    'seedance2.0fast',
    'seedance2.0_vip',
    'seedance2.0fast_vip',
]);
const FRAMES2VIDEO_MODELS = new Set([
    '3.0',
    '3.5pro',
    'seedance2.0',
    'seedance2.0fast',
    'seedance2.0_vip',
    'seedance2.0fast_vip',
]);
const MULTIMODAL_MODELS = new Set([
    'seedance2.0',
    'seedance2.0fast',
    'seedance2.0_vip',
    'seedance2.0fast_vip',
]);
const IMAGE_MODELS = ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '5.0'];
const IMAGE2IMAGE_MODELS = new Set(['4.0', '4.1', '4.5', '4.6', '5.0']);
const IMAGE_RATIOS = new Set(['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']);
const VIDEO_RATIOS = new Set(['1:1', '3:4', '16:9', '4:3', '9:16', '21:9']);
const TEXT2IMAGE_RESOLUTIONS_BY_MODEL = new Map([
    ['3.0', new Set(['1k', '2k'])],
    ['3.1', new Set(['1k', '2k'])],
    ['4.0', new Set(['2k', '4k'])],
    ['4.1', new Set(['2k', '4k'])],
    ['4.5', new Set(['2k', '4k'])],
    ['4.6', new Set(['2k', '4k'])],
    ['5.0', new Set(['2k', '4k'])],
]);
const IMAGE2IMAGE_RESOLUTIONS = new Set(['2k', '4k']);
const UPSCALE_RESOLUTIONS = new Set(['2k', '4k', '8k']);
const MODEL_CAPABILITIES = new Map();
const getFirstBodyValue = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null)
        return undefined;
    const text = String(raw).trim();
    return text === '' ? undefined : text;
};
const parseBodyList = (value) => {
    if (value === undefined || value === null || value === '')
        return [];
    if (Array.isArray(value)) {
        return value.flatMap(item => parseBodyList(item)).map(item => item.trim()).filter(Boolean);
    }
    const text = String(value).trim();
    if (!text)
        return [];
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed))
                return parseBodyList(parsed);
        }
        catch { }
    }
    return [text];
};
const normalizeVideoMode = (raw) => {
    const value = (getFirstBodyValue(raw) || 'auto').toLowerCase();
    const aliases = {
        auto: 'auto',
        text: 'text2video',
        text2video: 'text2video',
        image: 'image2video',
        image2video: 'image2video',
        frame: 'frames2video',
        frames: 'frames2video',
        first_last: 'frames2video',
        firstlast: 'frames2video',
        frames2video: 'frames2video',
        multiframe: 'multiframe2video',
        multi_frame: 'multiframe2video',
        multiframe2video: 'multiframe2video',
        multimodal: 'multimodal2video',
        multi_modal: 'multimodal2video',
        ref2video: 'multimodal2video',
        multimodal2video: 'multimodal2video',
    };
    return aliases[value] || null;
};
const getVideoResolutionValues = (mode, model) => {
    if (mode === 'multiframe2video')
        return new Set();
    if (model === 'seedance2.0_vip')
        return new Set(['720p', '1080p']);
    return new Set(['720p']);
};
const getVideoDurationRange = (mode, model) => {
    if (mode === 'text2video' || mode === 'multimodal2video')
        return [4, 15];
    if (model === '3.5pro')
        return [4, 12];
    if (model === '3.0' || model === '3.0fast' || model === '3.0pro')
        return [3, 10];
    return [4, 15];
};
const cleanupUploadedFiles = (files) => {
    if (!files)
        return;
    for (const file of files) {
        try {
            fs_1.default.unlinkSync(file.path);
        }
        catch { }
    }
};
const cleanupUploadedFile = (file) => {
    if (!file)
        return;
    try {
        fs_1.default.unlinkSync(file.path);
    }
    catch { }
};
const parseIntegerField = (value) => {
    const text = getFirstBodyValue(value);
    if (text === undefined)
        return null;
    if (!/^-?\d+$/.test(text))
        return null;
    return Number(text);
};
const parseFloatField = (value) => {
    const text = getFirstBodyValue(value);
    if (text === undefined)
        return null;
    const num = Number(text);
    return Number.isFinite(num) ? num : null;
};
const shellQuote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const buildSessionParam = (raw) => {
    const text = getFirstBodyValue(raw);
    if (text === undefined)
        return '';
    const session = Number(text);
    if (!Number.isInteger(session) || session < 0) {
        throw new Error('session must be a non-negative integer');
    }
    return `--session=${session}`;
};
const addModelCapability = (id, capability) => {
    if (!MODEL_CAPABILITIES.has(id)) {
        MODEL_CAPABILITIES.set(id, new Set());
    }
    MODEL_CAPABILITIES.get(id).add(capability);
};
IMAGE_MODELS.forEach(id => addModelCapability(id, 'image'));
Array.from(TEXT2VIDEO_MODELS).forEach(id => addModelCapability(id, 'text2video'));
Array.from(IMAGE2VIDEO_MODELS).forEach(id => addModelCapability(id, 'image2video'));
Array.from(FRAMES2VIDEO_MODELS).forEach(id => addModelCapability(id, 'frames2video'));
Array.from(MULTIMODAL_MODELS).forEach(id => addModelCapability(id, 'multimodal2video'));
addModelCapability('image_upscale', 'image_upscale');
const getExt = (fileName) => {
    const idx = fileName.lastIndexOf('.');
    if (idx < 0)
        return '';
    return fileName.slice(idx).toLowerCase();
};
const parseFps = (value) => {
    if (!value)
        return undefined;
    if (!value.includes('/')) {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    const [a, b] = value.split('/').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0)
        return undefined;
    return a / b;
};
let ffprobeAvailabilityChecked = false;
let ffprobeAvailable = false;
const ensureFfprobeAvailable = async () => {
    if (ffprobeAvailabilityChecked)
        return ffprobeAvailable;
    ffprobeAvailabilityChecked = true;
    try {
        await execFileAsync('ffprobe', ['-version'], { windowsHide: true, timeout: 5000 });
        ffprobeAvailable = true;
    }
    catch {
        ffprobeAvailable = false;
    }
    return ffprobeAvailable;
};
const probeMedia = async (filePath) => {
    try {
        const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath], { windowsHide: true, maxBuffer: 4 * MB, timeout: 10000 });
        const parsed = JSON.parse(stdout || '{}');
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        const videoStream = streams.find((s) => s.codec_type === 'video');
        const audioStream = streams.find((s) => s.codec_type === 'audio');
        const duration = Number(parsed.format?.duration);
        const streamDuration = Number(videoStream?.duration ?? audioStream?.duration);
        return {
            duration: Number.isFinite(duration) ? duration : (Number.isFinite(streamDuration) ? streamDuration : undefined),
            width: Number.isFinite(Number(videoStream?.width)) ? Number(videoStream.width) : undefined,
            height: Number.isFinite(Number(videoStream?.height)) ? Number(videoStream.height) : undefined,
            fps: parseFps(videoStream?.r_frame_rate),
        };
    }
    catch {
        return null;
    }
};
const validateSeedance2Inputs = async (orderedMedia) => {
    const details = [];
    const totalBytes = orderedMedia.reduce((sum, item) => sum + item.file.size, 0);
    if (totalBytes > REQUEST_MAX_BYTES) {
        details.push({
            field: 'request',
            message: `请求体文件总大小超限：${(totalBytes / MB).toFixed(2)}MB，最大允许 64MB`,
        });
    }
    let videoDurationTotal = 0;
    let audioDurationTotal = 0;
    const hasVideoOrAudio = orderedMedia.some(item => item.type === 'video' || item.type === 'audio');
    const canProbe = hasVideoOrAudio ? await ensureFfprobeAvailable() : true;
    if (hasVideoOrAudio && !canProbe) {
        details.push({
            field: 'server',
            message: '服务器缺少 ffprobe，无法校验视频/音频时长、分辨率与帧率。请安装 ffmpeg/ffprobe 后重试。',
        });
        return details;
    }
    for (const item of orderedMedia) {
        const f = item.file;
        const ext = getExt(f.originalname);
        if (item.type === 'image') {
            if (!IMAGE_EXTS.has(ext)) {
                details.push({ field: 'image', file: f.originalname, message: '图片格式不支持，仅支持 jpeg/png/webp/bmp/tiff/gif' });
            }
            if (f.size > IMAGE_MAX_BYTES) {
                details.push({ field: 'image', file: f.originalname, message: `图片大小超限：${(f.size / MB).toFixed(2)}MB，最大 30MB` });
            }
            continue;
        }
        if (item.type === 'video') {
            if (!VIDEO_EXTS.has(ext)) {
                details.push({ field: 'video', file: f.originalname, message: '视频格式不支持，仅支持 mp4/mov' });
            }
            if (f.size > VIDEO_MAX_BYTES) {
                details.push({ field: 'video', file: f.originalname, message: `视频大小超限：${(f.size / MB).toFixed(2)}MB，最大 50MB` });
            }
            const probe = await probeMedia(f.path);
            if (!probe || !Number.isFinite(probe.duration) || !Number.isFinite(probe.width) || !Number.isFinite(probe.height)) {
                details.push({ field: 'video', file: f.originalname, message: '无法读取视频元信息（时长/分辨率），请检查文件是否损坏。' });
                continue;
            }
            const d = probe.duration;
            const w = probe.width;
            const h = probe.height;
            const ratio = w / h;
            const pixels = w * h;
            videoDurationTotal += d;
            if (d < 2 || d > 15) {
                details.push({ field: 'video', file: f.originalname, message: `视频时长需在 [2, 15] 秒，当前 ${d.toFixed(2)} 秒` });
            }
            if (ratio < 0.4 || ratio > 2.5) {
                details.push({ field: 'video', file: f.originalname, message: `视频宽高比需在 [0.4, 2.5]，当前 ${ratio.toFixed(3)}` });
            }
            if (w < 300 || w > 6000 || h < 300 || h > 6000) {
                details.push({ field: 'video', file: f.originalname, message: `视频宽高像素需在 [300, 6000]，当前 ${w}x${h}` });
            }
            if (pixels < 409600 || pixels > 2086876) {
                details.push({ field: 'video', file: f.originalname, message: `视频像素总量需在 [409600, 2086876]，当前 ${pixels}` });
            }
            if (Number.isFinite(probe.fps)) {
                const fps = probe.fps;
                if (fps < 24 || fps > 60) {
                    details.push({ field: 'video', file: f.originalname, message: `视频帧率需在 [24, 60] FPS，当前 ${fps.toFixed(2)} FPS` });
                }
            }
            continue;
        }
        if (!AUDIO_EXTS.has(ext)) {
            details.push({ field: 'audio', file: f.originalname, message: '音频格式不支持，仅支持 wav/mp3' });
        }
        if (f.size > AUDIO_MAX_BYTES) {
            details.push({ field: 'audio', file: f.originalname, message: `音频大小超限：${(f.size / MB).toFixed(2)}MB，最大 15MB` });
        }
        const probe = await probeMedia(f.path);
        if (!probe || !Number.isFinite(probe.duration)) {
            details.push({ field: 'audio', file: f.originalname, message: '无法读取音频时长，请检查文件是否损坏。' });
            continue;
        }
        const d = probe.duration;
        audioDurationTotal += d;
        if (d < 2 || d > 15) {
            details.push({ field: 'audio', file: f.originalname, message: `音频时长需在 [2, 15] 秒，当前 ${d.toFixed(2)} 秒` });
        }
    }
    if (videoDurationTotal > 15) {
        details.push({ field: 'video', message: `所有视频总时长超限：${videoDurationTotal.toFixed(2)} 秒，最大 15 秒` });
    }
    if (audioDurationTotal > 15) {
        details.push({ field: 'audio', message: `所有音频总时长超限：${audioDurationTotal.toFixed(2)} 秒，最大 15 秒` });
    }
    return details;
};
const normalizeReferenceOrder = (raw) => {
    if (!raw)
        return [];
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(parsed))
        return [];
    const out = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object')
            continue;
        if (!['image', 'video', 'audio'].includes(item.type))
            continue;
        const index = Number(item.index);
        if (!Number.isFinite(index))
            continue;
        out.push({
            index,
            type: item.type,
            name: typeof item.name === 'string' ? item.name : undefined,
            size: Number.isFinite(Number(item.size)) ? Number(item.size) : undefined,
            lastModified: Number.isFinite(Number(item.lastModified)) ? Number(item.lastModified) : undefined,
        });
    }
    return out.sort((a, b) => a.index - b.index);
};
const buildOrderedMedia = (filesMap, referenceOrder) => {
    const pools = {
        image: [...(filesMap['image'] || [])],
        video: [...(filesMap['video'] || [])],
        audio: [...(filesMap['audio'] || [])],
    };
    const ordered = [];
    const consume = (ref) => {
        const pool = pools[ref.type];
        if (!pool.length)
            return null;
        let idx = -1;
        if (ref.name && ref.size !== undefined) {
            idx = pool.findIndex(f => f.originalname === ref.name && f.size === ref.size);
        }
        if (idx < 0 && ref.name) {
            idx = pool.findIndex(f => f.originalname === ref.name);
        }
        if (idx < 0) {
            idx = 0;
        }
        return pool.splice(idx, 1)[0] || null;
    };
    for (const ref of referenceOrder) {
        const file = consume(ref);
        if (file) {
            ordered.push({ type: ref.type, file, index: ref.index });
        }
    }
    for (const type of ['image', 'video', 'audio']) {
        for (const file of pools[type]) {
            ordered.push({ type, file, index: Number.MAX_SAFE_INTEGER });
        }
    }
    return ordered;
};
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
function extractSubmitInfo(stdout) {
    let submitId = '';
    let logId = null;
    try {
        const jsonStr = stdout.substring(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
        const result = JSON.parse(jsonStr);
        submitId = result.submit_id || result.task_id || result.data?.submit_id || '';
        logId = result.logid || result.log_id || result.data?.logid || null;
    }
    catch (e) { }
    if (!submitId) {
        const idMatch = stdout.match(/(?:submit_id|task_id|tid|id)["':\s=]+([a-zA-Z0-9_\-]+)/i);
        if (idMatch && idMatch[1])
            submitId = idMatch[1];
        else {
            const plainMatch = stdout.match(/\b([a-fA-F0-9]{16})\b/);
            if (plainMatch && plainMatch[1])
                submitId = plainMatch[1];
            else
                throw new Error("Cannot find submit_id in CLI output.\nRaw Output: " + stdout.substring(0, 500));
        }
    }
    if (!logId) {
        const logMatch = stdout.match(/logid["':\s=]+([a-zA-Z0-9_\-]+)/i);
        if (logMatch && logMatch[1])
            logId = logMatch[1];
    }
    return { submitId, logId };
}
router.get('/models', apiKeyAuth, (_req, res) => {
    res.json({
        object: 'list',
        data: Array.from(MODEL_CAPABILITIES.entries()).map(([id, capabilities]) => ({
            id,
            object: 'model',
            created: 0,
            owned_by: 'dreamina',
            capabilities: Array.from(capabilities),
        })),
    });
});
router.post('/images/generations', apiKeyAuth, upload.array('images', 10), async (req, res) => {
    let account = null;
    try {
        const files = req.files || [];
        const hasImages = files.length > 0;
        const prompt = getFirstBodyValue(req.body.prompt);
        const model = getFirstBodyValue(req.body.model) || '5.0';
        const resolutionType = getFirstBodyValue(req.body.resolution_type);
        const ratio = getFirstBodyValue(req.body.ratio) || '1:1';
        let sessionParam = '';
        try {
            sessionParam = buildSessionParam(req.body.session);
        }
        catch (err) {
            cleanupUploadedFiles(files);
            return res.status(400).json({ error: { message: err.message } });
        }
        const fail = (status, message) => {
            cleanupUploadedFiles(files);
            return res.status(status).json({ error: { message } });
        };
        if (!prompt && !hasImages) {
            return fail(400, "Either 'prompt' or an 'image' file is required.");
        }
        if (!IMAGE_RATIOS.has(ratio)) {
            return fail(400, 'ratio must be one of 21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16');
        }
        if (hasImages) {
            if (files.length > 10) {
                return fail(400, 'images must not exceed 10 files');
            }
            if (!IMAGE2IMAGE_MODELS.has(model)) {
                return fail(400, `model ${model} is not supported for image2image`);
            }
            if (resolutionType && !IMAGE2IMAGE_RESOLUTIONS.has(resolutionType)) {
                return fail(400, 'resolution_type for image2image must be 2k or 4k');
            }
        }
        else {
            const allowed = TEXT2IMAGE_RESOLUTIONS_BY_MODEL.get(model);
            if (!allowed) {
                return fail(400, `model ${model} is not supported for text2image`);
            }
            if (resolutionType && !allowed.has(resolutionType)) {
                return fail(400, `resolution_type for model ${model} must be one of ${Array.from(allowed).join(', ')}`);
            }
        }
        account = await accountService_1.accountService.getIdleAccount(req.apiBoundAccountId);
        if (!account) {
            cleanupUploadedFiles(files);
            return res.status(503).json({ error: { message: 'All Dreamina accounts are busy or out of credits. Please try again later.' } });
        }
        let command = "";
        let dbTaskType = "";
        if (hasImages) {
            const imagePathsCsv = files.map(f => `${process.cwd()}/${f.path}`).join(',');
            const resParam = resolutionType ? ` --resolution_type=${resolutionType}` : '';
            command = `dreamina image2image --images=${shellQuote(imagePathsCsv)} --prompt=${shellQuote(prompt || '')} --ratio=${ratio} --model_version=${model}${resParam} ${sessionParam} --poll=0`;
            dbTaskType = 'image2image';
        }
        else {
            const resParam = resolutionType ? ` --resolution_type=${resolutionType}` : '';
            command = `dreamina text2image --prompt=${shellQuote(prompt || '')} --ratio=${ratio} --model_version=${model}${resParam} ${sessionParam} --poll=0`;
            dbTaskType = 'text2image';
        }
        console.log(`[Jimeng Dispatcher] Executing: ${command}`);
        let dbTask;
        try {
            dbTask = await prisma.task.create({
                data: { apiKeyId: req.apiUserId, accountId: account.id, type: dbTaskType, model: model, prompt: prompt || '' }
            });
        }
        catch (dbErr) {
            await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
            cleanupUploadedFiles(files);
            return res.status(500).json({ error: { message: 'DB error: ' + dbErr.message } });
        }
        let submitId = "";
        try {
            const { stdout } = await (0, cliRunner_1.runJimengCommand)(command, account.homeDir);
            const info = extractSubmitInfo(stdout);
            submitId = info.submitId;
            await prisma.task.update({ where: { id: dbTask.id }, data: { status: 'PROCESSING', jimengSubmitId: submitId, jimengLogId: info.logId } });
        }
        catch (cmdErr) {
            await prisma.task.update({ where: { id: dbTask.id }, data: { status: 'FAILED', errorMsg: cmdErr.message } });
            const isNoVip = cmdErr.message.includes('高级会员') || cmdErr.message.includes('vip') || cmdErr.message.includes('VIP') || cmdErr.message.includes('member');
            await accountService_1.accountService.releaseAccount(account.id, isNoVip ? 'NO_VIP' : 'ERROR');
            cleanupUploadedFiles(files);
            return res.status(500).json({ error: { message: "Jimeng CLI failed: " + cmdErr.message } });
        }
        await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
        cleanupUploadedFiles(files);
        return res.json({ id: dbTask.id, status: "processing", submit_id: submitId });
    }
    catch (err) {
        if (account) {
            try {
                await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
            }
            catch { }
        }
        cleanupUploadedFiles(req.files || []);
        res.status(500).json({ error: { message: err.message } });
    }
});
router.post('/images/upscale', apiKeyAuth, upload.single('image'), async (req, res) => {
    let account = null;
    const file = req.file;
    try {
        if (!file) {
            return res.status(400).json({ error: { message: 'image file is required' } });
        }
        const resolutionType = getFirstBodyValue(req.body.resolution_type) || '2k';
        if (!UPSCALE_RESOLUTIONS.has(resolutionType)) {
            cleanupUploadedFile(file);
            return res.status(400).json({ error: { message: 'resolution_type must be one of 2k, 4k, 8k' } });
        }
        let sessionParam = '';
        try {
            sessionParam = buildSessionParam(req.body.session);
        }
        catch (err) {
            cleanupUploadedFile(file);
            return res.status(400).json({ error: { message: err.message } });
        }
        account = await accountService_1.accountService.getIdleAccount(req.apiBoundAccountId);
        if (!account) {
            cleanupUploadedFile(file);
            return res.status(503).json({ error: { message: 'All Dreamina accounts are busy or out of credits. Please try again later.' } });
        }
        const dbTask = await prisma.task.create({
            data: {
                apiKeyId: req.apiUserId,
                accountId: account.id,
                type: 'image_upscale',
                model: 'image_upscale',
                prompt: `upscale:${resolutionType}`,
            },
        });
        let submitId = '';
        try {
            const imagePath = `${process.cwd()}/${file.path}`;
            const command = `dreamina image_upscale --image=${shellQuote(imagePath)} --resolution_type=${resolutionType} ${sessionParam} --poll=0`;
            console.log(`[Jimeng Dispatcher] Executing: ${command}`);
            const { stdout } = await (0, cliRunner_1.runJimengCommand)(command, account.homeDir);
            const info = extractSubmitInfo(stdout);
            submitId = info.submitId;
            await prisma.task.update({
                where: { id: dbTask.id },
                data: { status: 'PROCESSING', jimengSubmitId: submitId, jimengLogId: info.logId },
            });
        }
        catch (cmdErr) {
            await prisma.task.update({ where: { id: dbTask.id }, data: { status: 'FAILED', errorMsg: cmdErr.message } });
            const isNoVip = cmdErr.message.includes('高级会员') || cmdErr.message.includes('vip') || cmdErr.message.includes('VIP') || cmdErr.message.includes('member');
            await accountService_1.accountService.releaseAccount(account.id, isNoVip ? 'NO_VIP' : 'ERROR');
            cleanupUploadedFile(file);
            return res.status(500).json({ error: { message: 'Jimeng CLI failed: ' + cmdErr.message } });
        }
        await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
        cleanupUploadedFile(file);
        return res.json({ id: dbTask.id, status: 'processing', submit_id: submitId });
    }
    catch (err) {
        if (account) {
            try {
                await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
            }
            catch { }
        }
        cleanupUploadedFile(file);
        return res.status(500).json({ error: { message: err.message } });
    }
});
router.post('/videos/generations', apiKeyAuth, upload.fields([{ name: 'image', maxCount: 20 }, { name: 'audio', maxCount: 3 }, { name: 'video', maxCount: 3 }]), async (req, res) => {
    const allFiles = [];
    if (req.files) {
        const fMap = req.files;
        if (fMap['image'])
            allFiles.push(...fMap['image']);
        if (fMap['audio'])
            allFiles.push(...fMap['audio']);
        if (fMap['video'])
            allFiles.push(...fMap['video']);
    }
    let account = null;
    try {
        const prompt = getFirstBodyValue(req.body.prompt);
        const rawModel = getFirstBodyValue(req.body.model);
        const modelProvided = rawModel !== undefined;
        const model = normalizeVideoModelVersion(rawModel || 'seedance2.0fast');
        const requestedMode = normalizeVideoMode(req.body.mode ?? req.body.task_type ?? req.body.command ?? req.body.video_mode);
        const durationRaw = getFirstBodyValue(req.body.duration);
        const ratioInput = getFirstBodyValue(req.body.ratio);
        const videoResolution = getFirstBodyValue(req.body.video_resolution);
        const transitionPromptsRaw = parseBodyList(req.body.transition_prompt ?? req.body.transition_prompts);
        const transitionDurationsRaw = parseBodyList(req.body.transition_duration ?? req.body.transition_durations);
        let sessionParam = '';
        try {
            sessionParam = buildSessionParam(req.body.session);
        }
        catch (err) {
            cleanupUploadedFiles(allFiles);
            return res.status(400).json({ error: { message: err.message } });
        }
        const fail = (status, message, details) => {
            cleanupUploadedFiles(allFiles);
            return res.status(status).json(details && details.length > 0 ? { error: { message, details } } : { error: { message } });
        };
        if (requestedMode === null) {
            return fail(400, 'mode must be one of auto, text2video, image2video, frames2video, multiframe2video, multimodal2video');
        }
        const filesMap = req.files || {};
        const referenceOrder = normalizeReferenceOrder(req.body.reference_order);
        const orderedMedia = buildOrderedMedia(filesMap, referenceOrder);
        const imageMedia = orderedMedia.filter(item => item.type === 'image');
        const videoMedia = orderedMedia.filter(item => item.type === 'video');
        const audioMedia = orderedMedia.filter(item => item.type === 'audio');
        const hasImages = imageMedia.length > 0;
        const hasVideos = videoMedia.length > 0;
        const hasAudio = audioMedia.length > 0;
        const hasMedia = orderedMedia.length > 0;
        const imageCount = imageMedia.length;
        const videoCount = videoMedia.length;
        const audioCount = audioMedia.length;
        const autoMode = !hasMedia
            ? 'text2video'
            : (hasVideos || hasAudio)
                ? 'multimodal2video'
                : imageCount === 1
                    ? 'image2video'
                    : imageCount === 2
                        ? (FRAMES2VIDEO_MODELS.has(model) ? 'frames2video' : 'multiframe2video')
                        : 'multiframe2video';
        const mode = requestedMode === 'auto' ? autoMode : requestedMode;
        if (referenceOrder.length > 0) {
            console.log(`[Jimeng Dispatcher] reference_order received: ${JSON.stringify(referenceOrder)}`);
        }
        if (hasAudio && !hasImages && !hasVideos) {
            return fail(400, 'Audio-only reference is not supported. Please upload at least one image or one video when using audio reference.');
        }
        if (mode === 'text2video') {
            if (hasMedia)
                return fail(400, 'text2video does not accept image, video, or audio references.');
            if (!prompt)
                return fail(400, 'prompt is required for text2video.');
            if (!TEXT2VIDEO_MODELS.has(model))
                return fail(400, `model ${model} is not supported for text2video.`);
        }
        if (mode === 'image2video') {
            if (imageCount !== 1 || hasVideos || hasAudio)
                return fail(400, 'image2video requires exactly 1 image and does not accept video or audio references.');
            if (!IMAGE2VIDEO_MODELS.has(model))
                return fail(400, `model ${model} is not supported for image2video.`);
        }
        if (mode === 'frames2video') {
            if (imageCount !== 2 || hasVideos || hasAudio)
                return fail(400, 'frames2video requires exactly 2 images and does not accept video or audio references.');
            if (!FRAMES2VIDEO_MODELS.has(model))
                return fail(400, `model ${model} is not supported for frames2video.`);
        }
        if (mode === 'multiframe2video') {
            if (imageCount < 2 || hasVideos || hasAudio)
                return fail(400, 'multiframe2video requires 2 to 20 images and does not accept video or audio references.');
            if (modelProvided)
                return fail(400, 'multiframe2video does not support model_version. Remove model or choose another video mode.');
            if (videoResolution)
                return fail(400, 'multiframe2video does not support video_resolution.');
            if (ratioInput)
                return fail(400, 'multiframe2video does not support ratio.');
            if (imageCount === 2) {
                if (transitionPromptsRaw.length > 0 || transitionDurationsRaw.length > 0) {
                    return fail(400, 'For exactly 2 images, use prompt and optional duration only. transition_prompt and transition_duration are for 3+ images.');
                }
                if (!prompt)
                    return fail(400, 'prompt is required for exactly 2 images in multiframe2video.');
            }
            else if (durationRaw !== undefined) {
                return fail(400, 'duration is only supported as shorthand for exactly 2 images in multiframe2video.');
            }
        }
        if (mode === 'multimodal2video') {
            if (!hasImages && !hasVideos)
                return fail(400, 'multimodal2video requires at least one image or one video reference.');
            if (!MULTIMODAL_MODELS.has(model))
                return fail(400, `model ${model} is not supported for multimodal2video.`);
            if (imageCount > 9)
                return fail(400, 'multimodal2video supports up to 9 images.');
            if (videoCount > 3)
                return fail(400, 'multimodal2video supports up to 3 videos.');
            if (audioCount > 3)
                return fail(400, 'multimodal2video supports up to 3 audio files.');
        }
        if (mode === 'multimodal2video' && model.includes('seedance2.0')) {
            const validationDetails = await validateSeedance2Inputs(orderedMedia);
            if (validationDetails.length > 0) {
                return fail(400, 'Seedance 2.0 输入校验失败', validationDetails);
            }
        }
        if (mode === 'text2video' || mode === 'multimodal2video') {
            const ratio = ratioInput || '16:9';
            if (ratioInput && !VIDEO_RATIOS.has(ratioInput)) {
                return fail(400, 'ratio must be one of 1:1, 3:4, 16:9, 4:3, 9:16, 21:9');
            }
            const duration = durationRaw === undefined ? 5 : parseIntegerField(durationRaw);
            if (duration === null)
                return fail(400, 'duration must be an integer');
            const [minDuration, maxDuration] = getVideoDurationRange(mode, model);
            if (duration < minDuration || duration > maxDuration) {
                return fail(400, `duration for ${mode} with model ${model} must be between ${minDuration} and ${maxDuration} seconds`);
            }
            if (videoResolution) {
                const allowed = getVideoResolutionValues(mode, model);
                if (!allowed.has(videoResolution)) {
                    return fail(400, `video_resolution for model ${model} must be one of ${Array.from(allowed).join(', ')}`);
                }
            }
        }
        if (mode === 'image2video' || mode === 'frames2video') {
            if (ratioInput)
                return fail(400, `${mode} does not support ratio.`);
            const duration = durationRaw === undefined ? 5 : parseIntegerField(durationRaw);
            if (duration === null)
                return fail(400, 'duration must be an integer');
            const [minDuration, maxDuration] = getVideoDurationRange(mode, model);
            if (duration < minDuration || duration > maxDuration) {
                return fail(400, `duration for ${mode} with model ${model} must be between ${minDuration} and ${maxDuration} seconds`);
            }
            if (videoResolution) {
                const allowed = getVideoResolutionValues(mode, model);
                if (!allowed.has(videoResolution)) {
                    return fail(400, `video_resolution for model ${model} must be one of ${Array.from(allowed).join(', ')}`);
                }
            }
        }
        if (mode === 'multiframe2video') {
            if (imageCount === 2) {
                const segmentDuration = durationRaw === undefined ? 3 : parseFloatField(durationRaw);
                if (segmentDuration === null)
                    return fail(400, 'duration must be a number');
                if (segmentDuration < 0.5 || segmentDuration > 8) {
                    return fail(400, 'duration for multiframe2video must be between 0.5 and 8 seconds per segment');
                }
            }
            else {
                const transitionCount = imageCount - 1;
                const prompts = transitionPromptsRaw.length > 0 ? transitionPromptsRaw : (prompt ? Array.from({ length: transitionCount }, () => prompt) : []);
                if (prompts.length !== transitionCount) {
                    return fail(400, `transition_prompt must contain exactly ${transitionCount} values for ${imageCount} images, or provide prompt shorthand.`);
                }
                const durations = transitionDurationsRaw.length > 0
                    ? transitionDurationsRaw.map(value => Number(value))
                    : Array.from({ length: transitionCount }, () => 3);
                if (durations.length !== transitionCount) {
                    return fail(400, `transition_duration must contain exactly ${transitionCount} values for ${imageCount} images.`);
                }
                for (const segmentDuration of durations) {
                    if (!Number.isFinite(segmentDuration) || segmentDuration < 0.5 || segmentDuration > 8) {
                        return fail(400, 'each transition_duration must be between 0.5 and 8 seconds');
                    }
                }
                const totalDuration = durations.reduce((sum, value) => sum + value, 0);
                if (totalDuration < 2) {
                    return fail(400, 'total duration for multiframe2video must be at least 2 seconds');
                }
            }
        }
        account = await accountService_1.accountService.getIdleAccount(req.apiBoundAccountId);
        if (!account) {
            cleanupUploadedFiles(allFiles);
            return res.status(503).json({ error: { message: 'All Dreamina accounts busy' } });
        }
        let command = "";
        let dbTaskType = "";
        let dbModel = model;
        const dbPrompt = prompt || '';
        if (mode === 'multimodal2video') {
            const mediaArgs = orderedMedia
                .map(item => {
                const mediaPath = `${process.cwd()}/${item.file.path}`;
                if (item.type === 'image')
                    return `--image=${shellQuote(mediaPath)}`;
                if (item.type === 'video')
                    return `--video=${shellQuote(mediaPath)}`;
                return `--audio=${shellQuote(mediaPath)}`;
            })
                .join(' ');
            const ratio = ratioInput || '16:9';
            const duration = durationRaw === undefined ? 5 : Number(durationRaw);
            const promptParam = prompt ? ` --prompt=${shellQuote(prompt)}` : '';
            const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
            command = `dreamina multimodal2video ${mediaArgs}${promptParam} --model_version=${model} --duration=${duration} --ratio=${ratio}${videoResolutionParam} ${sessionParam} --poll=0`;
            dbTaskType = 'multimodal2video';
        }
        else if (mode === 'frames2video') {
            const firstImage = imageMedia[0].file;
            const lastImage = imageMedia[1].file;
            const firstPath = `${process.cwd()}/${firstImage.path}`;
            const lastPath = `${process.cwd()}/${lastImage.path}`;
            const duration = durationRaw === undefined ? 5 : Number(durationRaw);
            const promptParam = prompt ? ` --prompt=${shellQuote(prompt)}` : '';
            const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
            command = `dreamina frames2video --first=${shellQuote(firstPath)} --last=${shellQuote(lastPath)}${promptParam} --model_version=${model} --duration=${duration}${videoResolutionParam} ${sessionParam} --poll=0`;
            dbTaskType = 'frames2video';
        }
        else if (mode === 'multiframe2video') {
            const imagePathCsv = imageMedia.map(item => `${process.cwd()}/${item.file.path}`).join(',');
            const imagePaths = `--images=${shellQuote(imagePathCsv)}`;
            if (imageCount === 2) {
                const duration = durationRaw === undefined ? 3 : parseFloatField(durationRaw);
                command = `dreamina multiframe2video ${imagePaths} --prompt=${shellQuote(prompt || '')} --duration=${duration} ${sessionParam} --poll=0`;
            }
            else {
                const transitionCount = imageCount - 1;
                const prompts = transitionPromptsRaw.length > 0 ? transitionPromptsRaw : Array.from({ length: transitionCount }, () => prompt || '');
                const durations = transitionDurationsRaw.length > 0
                    ? transitionDurationsRaw.map(value => Number(value))
                    : Array.from({ length: transitionCount }, () => 3);
                const transitionPromptArgs = prompts.map(value => `--transition-prompt=${shellQuote(value)}`).join(' ');
                const transitionDurationArgs = durations.map(value => `--transition-duration=${value}`).join(' ');
                command = `dreamina multiframe2video ${imagePaths} ${transitionPromptArgs} ${transitionDurationArgs} ${sessionParam} --poll=0`;
            }
            dbTaskType = 'multiframe2video';
            dbModel = null;
        }
        else if (mode === 'image2video') {
            const firstImage = imageMedia[0].file;
            const imagePath = `${process.cwd()}/${firstImage.path}`;
            const duration = durationRaw === undefined ? 5 : Number(durationRaw);
            const promptParam = prompt ? ` --prompt=${shellQuote(prompt)}` : '';
            const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
            command = `dreamina image2video --image=${shellQuote(imagePath)}${promptParam} --model_version=${model} --duration=${duration}${videoResolutionParam} ${sessionParam} --poll=0`;
            dbTaskType = 'image2video';
        }
        else {
            const duration = durationRaw === undefined ? 5 : Number(durationRaw);
            const ratio = ratioInput || '16:9';
            const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
            command = `dreamina text2video --prompt=${shellQuote(prompt || '')} --ratio=${ratio} --model_version=${model} --duration=${duration}${videoResolutionParam} ${sessionParam} --poll=0`;
            dbTaskType = 'text2video';
        }
        console.log(`[Jimeng Dispatcher] Executing: ${command}`);
        let dbTask;
        try {
            dbTask = await prisma.task.create({
                data: { apiKeyId: req.apiUserId, accountId: account.id, type: dbTaskType, model: dbModel, prompt: dbPrompt }
            });
        }
        catch (dbErr) {
            await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
            cleanupUploadedFiles(allFiles);
            return res.status(500).json({ error: { message: 'DB error: ' + dbErr.message } });
        }
        let submitId = "";
        try {
            const { stdout } = await (0, cliRunner_1.runJimengCommand)(command, account.homeDir);
            const info = extractSubmitInfo(stdout);
            submitId = info.submitId;
            await prisma.task.update({ where: { id: dbTask.id }, data: { status: 'PROCESSING', jimengSubmitId: submitId, jimengLogId: info.logId } });
        }
        catch (cmdErr) {
            await prisma.task.update({ where: { id: dbTask.id }, data: { status: 'FAILED', errorMsg: cmdErr.message } });
            const isNoVip = cmdErr.message.includes('高级会员') || cmdErr.message.includes('vip') || cmdErr.message.includes('VIP') || cmdErr.message.includes('member');
            await accountService_1.accountService.releaseAccount(account.id, isNoVip ? 'NO_VIP' : 'ERROR');
            cleanupUploadedFiles(allFiles);
            return res.status(500).json({ error: { message: "Jimeng CLI failed: " + cmdErr.message } });
        }
        await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
        cleanupUploadedFiles(allFiles);
        return res.json({ id: dbTask.id, status: "processing", submit_id: submitId });
    }
    catch (err) {
        if (account) {
            try {
                await accountService_1.accountService.releaseAccount(account.id, 'IDLE');
            }
            catch { }
        }
        cleanupUploadedFiles(allFiles);
        res.status(500).json({ error: { message: err.message } });
    }
});
router.get('/tasks/:id', apiKeyAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { account: true, apiKey: true }
        });
        if (!task)
            return res.status(404).json({ error: { message: "Task not found" } });
        if (task.apiKeyId !== req.apiUserId)
            return res.status(404).json({ error: { message: "Task not found" } });
        // Database polling mode - purely return what's in DB
        if (task.status === "SUCCESS") {
            return res.json({ id: task.id, status: "success", data: [{ url: task.resultUrl }] });
        }
        if (task.status === "FAILED") {
            return res.json({ id: task.id, status: "failed", error: task.errorMsg || "Generation failed" });
        }
        // If it's PENDING or PROCESSING, just return processing. The daemon handles the CLI.
        // 如果有 pollErrorMsg，告知调用者我方网络异常（任务仍在火山排队，不代表失败）
        const response = { id: task.id, status: "processing" };
        if (task.pollErrorMsg) {
            response.poll_warning = task.pollErrorMsg;
        }
        return res.json(response);
    }
    catch (err) {
        console.error("Error checking task ID:", req.params.id, err);
        res.status(500).json({ error: { message: "Internal server error" } });
    }
});
exports.default = router;
//# sourceMappingURL=openai.js.map