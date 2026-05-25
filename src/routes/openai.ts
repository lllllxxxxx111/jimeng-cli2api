/**
 * @file openai.ts
 * @description OpenAI-compatible Dreamina image, video, upscale, and Responses routes.
 * @author XiaoYue <43854695@qq.com>
 * @license MIT
 * @date 2026-04-17
 *
 * Guardrails:
 * - Do not hard-code API keys or machine-local media paths in this file.
 * - Keep media size, duration, and frame-rate validation near the constants below.
 * - Use ffprobe for real video/audio metadata instead of trusting filename suffixes.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { accountService } from '../services/accountService';
import { runJimengCommand } from '../utils/cliRunner';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ dest: 'temp_uploads/' });
const execFileAsync = promisify(execFile);

const MB = 1024 * 1024;
const IMAGE_MAX_BYTES = 30 * MB;
const VIDEO_MAX_BYTES = 50 * MB;
const AUDIO_MAX_BYTES = 15 * MB;
const REQUEST_MAX_BYTES = 64 * MB;
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov']);
const AUDIO_EXTS = new Set(['.wav', '.mp3']);
const TEMP_UPLOAD_ROOT = path.resolve(process.cwd(), 'temp_uploads');
const responsesUpload = multer({
  dest: 'temp_uploads/',
  limits: { fileSize: VIDEO_MAX_BYTES, files: 30 },
});

type ValidationDetail = {
  field: string;
  file?: string;
  message: string;
};

type DispatchResult = {
  id: string;
  status: 'processing';
  submit_id: string;
  task_type: string;
  model: string | null;
};

type ModelAliasKind = 'image' | 'video' | 'video_frames' | 'video_multimodal' | 'video_keyframes' | 'upscale';

type ModelAlias = {
  id: string;
  object: 'model';
  created: number;
  owned_by: 'dreamina';
  kind: ModelAliasKind;
  cli_model: string | null;
  capabilities: string[];
  default_mode: string;
  description: string;
  parameters: Record<string, unknown>;
};

const normalizeVideoModelVersion = (raw: string): string => {
  const model = (raw || '').trim();
  const map: Record<string, string> = {
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
const TEXT2IMAGE_RESOLUTIONS_BY_MODEL = new Map<string, Set<string>>([
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
const MODEL_CAPABILITIES = new Map<string, Set<string>>();
const VIDEO_TASK_TYPES = ['text2video', 'image2video', 'frames2video', 'multiframe2video', 'multimodal2video'];
const OPENAI_VIDEO_MODEL_ALIASES: Record<string, string> = {
  'sora-2': 'seedance2.0fast',
  'sora-2-pro': 'seedance2.0_vip',
};
const OPENAI_VIDEO_SIZE_TO_RATIO: Record<string, string> = {
  '720x1280': '9:16',
  '1280x720': '16:9',
  '1024x1792': '9:16',
  '1792x1024': '16:9',
};
const RATIO_TO_OPENAI_VIDEO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '3:4': '720x960',
  '4:3': '960x720',
  '9:16': '720x1280',
  '16:9': '1280x720',
  '21:9': '1792x768',
};

const UPSCALE_ALIAS_TO_RESOLUTION: Record<string, string> = {
  'jimeng-upscale-2k': '2k',
  'jimeng-upscale-4k': '4k',
  'jimeng-upscale-8k': '8k',
};

type VideoMode = 'text2video' | 'image2video' | 'frames2video' | 'multiframe2video' | 'multimodal2video';
type AutoVideoMode = VideoMode | 'auto';

const getFirstBodyValue = (value: any): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim();
  return text === '' ? undefined : text;
};

const parseBodyList = (value: any): string[] => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => parseBodyList(item)).map(item => item.trim()).filter(Boolean);
  }

  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parseBodyList(parsed);
    } catch {}
  }

  return [text];
};

const normalizeVideoMode = (raw: any): AutoVideoMode | null => {
  const value = (getFirstBodyValue(raw) || 'auto').toLowerCase();
  const aliases: Record<string, AutoVideoMode> = {
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

const getVideoResolutionValues = (mode: VideoMode, model: string): Set<string> => {
  if (mode === 'multiframe2video') return new Set();
  if (model === 'seedance2.0_vip') return new Set(['720p', '1080p']);
  return new Set(['720p']);
};

const getVideoDurationRange = (mode: VideoMode, model: string): [number, number] => {
  if (mode === 'text2video' || mode === 'multimodal2video') return [4, 15];
  if (model === '3.5pro') return [4, 12];
  if (model === '3.0' || model === '3.0fast' || model === '3.0pro') return [3, 10];
  return [4, 15];
};

const cleanupUploadedFiles = (files: Express.Multer.File[] | undefined) => {
  if (!files) return;
  for (const file of files) {
    cleanupUploadedFile(file);
  }
};

const cleanupUploadedFile = (file: Express.Multer.File | undefined) => {
  if (!file || !isManagedTempFile(file)) return;
  const resolved = path.resolve(process.cwd(), file.path);
  try {
    fs.unlinkSync(resolved);
  } catch {}
};

const isManagedTempFile = (file: Express.Multer.File): boolean => {
  const resolved = path.resolve(process.cwd(), file.path);
  const relative = path.relative(TEMP_UPLOAD_ROOT, resolved);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const createEmptyMediaFilesMap = (): Record<RefType, Express.Multer.File[]> => ({
  image: [],
  video: [],
  audio: [],
});

const classifyMediaFileType = (file: Express.Multer.File): RefType => {
  const field = String(file.fieldname || '').toLowerCase();
  const ext = getExt(file.originalname || file.filename);
  const mime = String(file.mimetype || '').toLowerCase();
  if (field === 'input_reference' || field.includes('image') || mime.startsWith('image/')) return 'image';
  if (field.includes('audio') || mime.startsWith('audio/')) return 'audio';
  if (field.includes('video') || mime.startsWith('video/')) return 'video';
  if (field.includes('audio') || AUDIO_EXTS.has(ext)) return 'audio';
  if (field.includes('video') || VIDEO_EXTS.has(ext)) return 'video';
  return 'image';
};

const normalizeUploadedMediaFiles = (
  uploaded: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined
): { filesMap: Record<RefType, Express.Multer.File[]>; files: Express.Multer.File[] } => {
  const filesMap = createEmptyMediaFilesMap();
  const imageFirst: Express.Multer.File[] = [];
  const imageMiddle: Express.Multer.File[] = [];
  const imageLast: Express.Multer.File[] = [];
  const files: Express.Multer.File[] = [];

  const add = (file: Express.Multer.File) => {
    files.push(file);
    const type = classifyMediaFileType(file);
    if (type !== 'image') {
      filesMap[type].push(file);
      return;
    }

    const field = String(file.fieldname || '').toLowerCase();
    if (field === 'first' || field.includes('first')) imageFirst.push(file);
    else if (field === 'last' || field.includes('last')) imageLast.push(file);
    else imageMiddle.push(file);
  };

  if (Array.isArray(uploaded)) {
    uploaded.forEach(add);
  } else if (uploaded) {
    Object.values(uploaded).flat().forEach(add);
  }

  filesMap.image.push(...imageFirst, ...imageMiddle, ...imageLast);
  return { filesMap, files };
};

const parseIntegerField = (value: any): number | null => {
  const text = getFirstBodyValue(value);
  if (text === undefined) return null;
  if (!/^-?\d+$/.test(text)) return null;
  return Number(text);
};

const parseFloatField = (value: any): number | null => {
  const text = getFirstBodyValue(value);
  if (text === undefined) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
};

const shellQuote = (value: string): string => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const getCliFilePath = (file: Express.Multer.File): string => {
  return path.isAbsolute(file.path) ? file.path : path.resolve(process.cwd(), file.path);
};

const buildSessionParam = (raw: any): string => {
  const text = getFirstBodyValue(raw);
  if (text === undefined) return '';
  const session = Number(text);
  if (!Number.isInteger(session) || session < 0) {
    throw new Error('session must be a non-negative integer');
  }
  return `--session=${session}`;
};

const addModelCapability = (id: string, capability: string) => {
  if (!MODEL_CAPABILITIES.has(id)) {
    MODEL_CAPABILITIES.set(id, new Set());
  }
  MODEL_CAPABILITIES.get(id)!.add(capability);
};

IMAGE_MODELS.forEach(id => {
  addModelCapability(id, 'image');
  addModelCapability(id, 'text2image');
});
Array.from(IMAGE2IMAGE_MODELS).forEach(id => addModelCapability(id, 'image2image'));
Array.from(TEXT2VIDEO_MODELS).forEach(id => addModelCapability(id, 'text2video'));
Array.from(IMAGE2VIDEO_MODELS).forEach(id => addModelCapability(id, 'image2video'));
Array.from(FRAMES2VIDEO_MODELS).forEach(id => addModelCapability(id, 'frames2video'));
Array.from(MULTIMODAL_MODELS).forEach(id => addModelCapability(id, 'multimodal2video'));
addModelCapability('image_upscale', 'image_upscale');

const setToArray = (values: Set<string> | undefined) => values ? Array.from(values) : [];

const getImageParameters = (model: string) => {
  if (model === 'image_upscale') {
    return {
      image_upscale: {
        image: { min: 1, max: 1, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
        resolution_type: setToArray(UPSCALE_RESOLUTIONS),
        vip_required_for: ['4k', '8k'],
        session: { type: 'integer', min: 0 },
      },
    };
  }

  const parameters: Record<string, unknown> = {};
  if (IMAGE_MODELS.includes(model)) {
    parameters.text2image = {
      prompt: { required: true },
      ratio: setToArray(IMAGE_RATIOS),
      resolution_type: setToArray(TEXT2IMAGE_RESOLUTIONS_BY_MODEL.get(model)),
      session: { type: 'integer', min: 0 },
    };
  }
  if (IMAGE2IMAGE_MODELS.has(model)) {
    parameters.image2image = {
      images: { min: 1, max: 10, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
      prompt: { required: false },
      ratio: setToArray(IMAGE_RATIOS),
      resolution_type: setToArray(IMAGE2IMAGE_RESOLUTIONS),
      session: { type: 'integer', min: 0 },
    };
  }
  return parameters;
};

const getVideoModeParameters = (mode: VideoMode, model: string) => {
  const [minDuration, maxDuration] = getVideoDurationRange(mode, model);
  const common = {
    duration: { min: minDuration, max: maxDuration, unit: 'seconds' },
    video_resolution: setToArray(getVideoResolutionValues(mode, model)),
    session: { type: 'integer', min: 0 },
  };

  if (mode === 'text2video') {
    return {
      ...common,
      prompt: { required: true },
      ratio: setToArray(VIDEO_RATIOS),
    };
  }
  if (mode === 'image2video') {
    return {
      ...common,
      image: { min: 1, max: 1, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
      prompt: { required: false },
      ratio: 'inferred_from_input_image',
    };
  }
  if (mode === 'frames2video') {
    return {
      ...common,
      first: { required: true, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
      last: { required: true, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
      prompt: { required: false },
      ratio: 'inferred_from_first_frame',
    };
  }
  if (mode === 'multimodal2video') {
    return {
      ...common,
      image: { min: 0, max: 9, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
      video: { min: 0, max: 3, max_bytes: VIDEO_MAX_BYTES, extensions: Array.from(VIDEO_EXTS), duration: { min: 2, max: 15 } },
      audio: { min: 0, max: 3, max_bytes: AUDIO_MAX_BYTES, extensions: Array.from(AUDIO_EXTS), duration: { min: 2, max: 15 } },
      at_least_one: ['image', 'video'],
      prompt: { required: false },
      ratio: setToArray(VIDEO_RATIOS),
      request_max_bytes: REQUEST_MAX_BYTES,
    };
  }
  return {};
};

const getModelParameters = (id: string) => {
  const parameters: Record<string, unknown> = getImageParameters(id);

  if (TEXT2VIDEO_MODELS.has(id)) parameters.text2video = getVideoModeParameters('text2video', id);
  if (IMAGE2VIDEO_MODELS.has(id)) parameters.image2video = getVideoModeParameters('image2video', id);
  if (FRAMES2VIDEO_MODELS.has(id)) parameters.frames2video = getVideoModeParameters('frames2video', id);
  if (MULTIMODAL_MODELS.has(id)) parameters.multimodal2video = getVideoModeParameters('multimodal2video', id);

  return parameters;
};

const getMultiframeParameters = () => ({
  images: { min: 2, max: 20, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
  exactly_two_images: {
    prompt: { required: true },
    duration: { min: 0.5, max: 8, unit: 'seconds', default: 3 },
  },
  three_or_more_images: {
    transition_prompt: { count: 'images.length - 1', required: true },
    transition_duration: { count: 'images.length - 1', min: 0.5, max: 8, unit: 'seconds', default: 3 },
    total_duration: { min: 2, unit: 'seconds' },
  },
  unsupported: ['model_version', 'video_resolution', 'ratio'],
  ratio: 'inferred_from_first_image',
  session: { type: 'integer', min: 0 },
});

const buildModelAliases = (): ModelAlias[] => {
  const imageAliases = IMAGE_MODELS.map((model) => {
    const capabilities = ['text2image'];
    if (IMAGE2IMAGE_MODELS.has(model)) capabilities.push('image2image');
    return {
      id: `jimeng-image-${model}`,
      object: 'model' as const,
      created: 0,
      owned_by: 'dreamina' as const,
      kind: 'image' as const,
      cli_model: model,
      capabilities,
      default_mode: 'text2image',
      description: `Jimeng image model ${model}`,
      parameters: getImageParameters(model),
    };
  });

  const videoModels = Array.from(new Set([
    ...Array.from(TEXT2VIDEO_MODELS),
    ...Array.from(IMAGE2VIDEO_MODELS),
    ...Array.from(FRAMES2VIDEO_MODELS),
    ...Array.from(MULTIMODAL_MODELS),
  ])).sort();

  const videoAliases = videoModels.flatMap((model) => {
    const capabilities: string[] = [];
    if (TEXT2VIDEO_MODELS.has(model)) capabilities.push('text2video');
    if (IMAGE2VIDEO_MODELS.has(model)) capabilities.push('image2video');
    if (MULTIMODAL_MODELS.has(model)) capabilities.push('multimodal2video');

    const aliases: ModelAlias[] = [];
    if (capabilities.length > 0) {
      aliases.push({
        id: `jimeng-video-${model}`,
        object: 'model',
        created: 0,
        owned_by: 'dreamina',
        kind: 'video',
        cli_model: model,
        capabilities,
        default_mode: 'auto',
        description: `Jimeng video model ${model}; text, single-image, and multimodal references are inferred from input.`,
        parameters: Object.fromEntries(capabilities.map(mode => [mode, getVideoModeParameters(mode as VideoMode, model)])),
      });
    }

    if (FRAMES2VIDEO_MODELS.has(model)) {
      aliases.push({
        id: `jimeng-video-frames-${model}`,
        object: 'model',
        created: 0,
        owned_by: 'dreamina',
        kind: 'video_frames',
        cli_model: model,
        capabilities: ['frames2video'],
        default_mode: 'frames2video',
        description: `Jimeng first/last-frame video model ${model}; exactly two images are required.`,
        parameters: { frames2video: getVideoModeParameters('frames2video', model) },
      });
    }

    if (MULTIMODAL_MODELS.has(model)) {
      aliases.push({
        id: `jimeng-video-multimodal-${model}`,
        object: 'model',
        created: 0,
        owned_by: 'dreamina',
        kind: 'video_multimodal',
        cli_model: model,
        capabilities: ['multimodal2video'],
        default_mode: 'multimodal2video',
        description: `Jimeng multimodal video model ${model}; images, videos, and optional audio are accepted.`,
        parameters: { multimodal2video: getVideoModeParameters('multimodal2video', model) },
      });
    }

    return aliases;
  });

  const upscaleAliases = Object.entries(UPSCALE_ALIAS_TO_RESOLUTION).map(([id, resolution]) => ({
    id,
    object: 'model' as const,
    created: 0,
    owned_by: 'dreamina' as const,
    kind: 'upscale' as const,
    cli_model: 'image_upscale',
    capabilities: ['image_upscale'],
    default_mode: 'image_upscale',
    description: `Jimeng image upscale to ${resolution}`,
    parameters: {
      image_upscale: {
        image: { min: 1, max: 1, max_bytes: IMAGE_MAX_BYTES, extensions: Array.from(IMAGE_EXTS) },
        resolution_type: [resolution],
        session: { type: 'integer', min: 0 },
      },
    },
  }));

  const keyframeAlias: ModelAlias = {
    id: 'jimeng-video-keyframes',
    object: 'model',
    created: 0,
    owned_by: 'dreamina',
    kind: 'video_keyframes',
    cli_model: null,
    capabilities: ['multiframe2video'],
    default_mode: 'multiframe2video',
    description: 'Jimeng multi-keyframe video; accepts 2 to 20 images and does not use model_version.',
    parameters: { multiframe2video: getMultiframeParameters() },
  };

  return [...imageAliases, ...videoAliases, keyframeAlias, ...upscaleAliases];
};

const MODEL_ALIASES = buildModelAliases();
const MODEL_ALIAS_BY_ID = new Map(MODEL_ALIASES.map(alias => [alias.id, alias]));

const legacyModelEntry = (id: string, capabilities: Set<string>) => ({
  id,
  object: 'model',
  created: 0,
  owned_by: 'dreamina',
  capabilities: Array.from(capabilities),
  parameters: getModelParameters(id),
  legacy: true,
});

const publicModelList = () => ([
  ...MODEL_ALIASES,
  ...Array.from(MODEL_CAPABILITIES.entries()).map(([id, capabilities]) => legacyModelEntry(id, capabilities)),
]);

const parseJimengModelAlias = (raw: any) => {
  const id = getFirstBodyValue(raw);
  if (!id) return null;
  return MODEL_ALIAS_BY_ID.get(id) || null;
};

const resolveImageModelAlias = (raw: any) => {
  const alias = parseJimengModelAlias(raw);
  if (!alias) return null;
  if (alias.kind !== 'image') {
    throw httpError(400, `model ${alias.id} is not an image generation model. Use a jimeng-image-* model.`);
  }
  return alias;
};

const resolveVideoModelAlias = (raw: any) => {
  const alias = parseJimengModelAlias(raw);
  if (!alias) return null;
  if (alias.kind !== 'video' && alias.kind !== 'video_frames' && alias.kind !== 'video_multimodal' && alias.kind !== 'video_keyframes') {
    throw httpError(400, `model ${alias.id} is not a video generation model. Use a jimeng-video-* model.`);
  }
  return alias;
};

const resolveUpscaleModelAlias = (raw: any) => {
  const alias = parseJimengModelAlias(raw);
  if (!alias) return null;
  if (alias.kind !== 'upscale') {
    throw httpError(400, `model ${alias.id} is not an upscale model. Use a jimeng-upscale-* model.`);
  }
  return alias;
};

const aliasDefaultMode = (alias: ModelAlias | null) => alias?.default_mode;

const GLOBAL_MODE_PARAMETERS = {
  multiframe2video: getMultiframeParameters(),
};

type RefType = 'image' | 'video' | 'audio';

type RefOrderItem = {
  index: number;
  type: RefType;
  name?: string;
  size?: number;
  lastModified?: number;
};

type ProbeResult = {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
};

const getExt = (fileName: string): string => {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0) return '';
  return fileName.slice(idx).toLowerCase();
};

const parseFps = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  if (!value.includes('/')) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  const [a, b] = value.split('/').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return undefined;
  return a / b;
};

let ffprobeAvailabilityChecked = false;
let ffprobeAvailable = false;

const ensureFfprobeAvailable = async (): Promise<boolean> => {
  if (ffprobeAvailabilityChecked) return ffprobeAvailable;
  ffprobeAvailabilityChecked = true;
  try {
    await execFileAsync('ffprobe', ['-version'], { windowsHide: true, timeout: 5000 });
    ffprobeAvailable = true;
  } catch {
    ffprobeAvailable = false;
  }
  return ffprobeAvailable;
};

const probeMedia = async (filePath: string): Promise<ProbeResult | null> => {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { windowsHide: true, maxBuffer: 4 * MB, timeout: 10000 }
    );

    const parsed = JSON.parse(stdout || '{}');
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    const duration = Number(parsed.format?.duration);
    const streamDuration = Number(videoStream?.duration ?? audioStream?.duration);

    return {
      duration: Number.isFinite(duration) ? duration : (Number.isFinite(streamDuration) ? streamDuration : undefined),
      width: Number.isFinite(Number(videoStream?.width)) ? Number(videoStream.width) : undefined,
      height: Number.isFinite(Number(videoStream?.height)) ? Number(videoStream.height) : undefined,
      fps: parseFps(videoStream?.r_frame_rate),
    };
  } catch {
    return null;
  }
};

const validateSeedance2Inputs = async (
  orderedMedia: Array<{ type: RefType; file: Express.Multer.File; index: number }>
): Promise<ValidationDetail[]> => {
  const details: ValidationDetail[] = [];

  const totalBytes = orderedMedia.reduce((sum, item) => sum + item.file.size, 0);
  if (totalBytes > REQUEST_MAX_BYTES) {
    details.push({
      field: 'request',
      message: `request files total ${(totalBytes / MB).toFixed(2)}MB exceeds the 64MB limit`,
    });
  }

  let videoDurationTotal = 0;
  let audioDurationTotal = 0;
  const hasVideoOrAudio = orderedMedia.some(item => item.type === 'video' || item.type === 'audio');
  const canProbe = hasVideoOrAudio ? await ensureFfprobeAvailable() : true;

  if (hasVideoOrAudio && !canProbe) {
    details.push({
      field: 'server',
      message: 'ffprobe is required to validate video/audio duration, resolution, and frame rate',
    });
    return details;
  }

  for (const item of orderedMedia) {
    const f = item.file;
    const ext = getExt(f.originalname);

    if (item.type === 'image') {
      if (!IMAGE_EXTS.has(ext)) {
        details.push({ field: 'image', file: f.originalname, message: 'unsupported image format; use jpeg/png/webp/bmp/tiff/gif' });
      }
      if (f.size > IMAGE_MAX_BYTES) {
        details.push({ field: 'image', file: f.originalname, message: `image size ${(f.size / MB).toFixed(2)}MB exceeds the 30MB limit` });
      }
      continue;
    }

    if (item.type === 'video') {
      if (!VIDEO_EXTS.has(ext)) {
        details.push({ field: 'video', file: f.originalname, message: 'unsupported video format; use mp4/mov' });
      }
      if (f.size > VIDEO_MAX_BYTES) {
        details.push({ field: 'video', file: f.originalname, message: `video size ${(f.size / MB).toFixed(2)}MB exceeds the 50MB limit` });
      }

      const probe = await probeMedia(f.path);
      if (!probe || !Number.isFinite(probe.duration as number) || !Number.isFinite(probe.width as number) || !Number.isFinite(probe.height as number)) {
        details.push({ field: 'video', file: f.originalname, message: 'unable to read video metadata; check whether the file is valid' });
        continue;
      }

      const d = probe.duration as number;
      const w = probe.width as number;
      const h = probe.height as number;
      const ratio = w / h;
      const pixels = w * h;

      videoDurationTotal += d;

      if (d < 2 || d > 15) {
        details.push({ field: 'video', file: f.originalname, message: `video duration must be in [2, 15] seconds, got ${d.toFixed(2)}` });
      }
      if (ratio < 0.4 || ratio > 2.5) {
        details.push({ field: 'video', file: f.originalname, message: `video aspect ratio must be in [0.4, 2.5], got ${ratio.toFixed(3)}` });
      }
      if (w < 300 || w > 6000 || h < 300 || h > 6000) {
        details.push({ field: 'video', file: f.originalname, message: `video width/height must be in [300, 6000], got ${w}x${h}` });
      }
      if (pixels < 409600 || pixels > 2086876) {
        details.push({ field: 'video', file: f.originalname, message: `video pixel count must be in [409600, 2086876], got ${pixels}` });
      }
      if (Number.isFinite(probe.fps as number)) {
        const fps = probe.fps as number;
        if (fps < 24 || fps > 60) {
          details.push({ field: 'video', file: f.originalname, message: `video frame rate must be in [24, 60] FPS, got ${fps.toFixed(2)}` });
        }
      }
      continue;
    }

    if (!AUDIO_EXTS.has(ext)) {
      details.push({ field: 'audio', file: f.originalname, message: 'unsupported audio format; use wav/mp3' });
    }
    if (f.size > AUDIO_MAX_BYTES) {
      details.push({ field: 'audio', file: f.originalname, message: `audio size ${(f.size / MB).toFixed(2)}MB exceeds the 15MB limit` });
    }

    const probe = await probeMedia(f.path);
    if (!probe || !Number.isFinite(probe.duration as number)) {
      details.push({ field: 'audio', file: f.originalname, message: 'unable to read audio duration; check whether the file is valid' });
      continue;
    }
    const d = probe.duration as number;
    audioDurationTotal += d;
    if (d < 2 || d > 15) {
      details.push({ field: 'audio', file: f.originalname, message: `audio duration must be in [2, 15] seconds, got ${d.toFixed(2)}` });
    }
  }

  if (videoDurationTotal > 15) {
    details.push({ field: 'video', message: `total video duration ${videoDurationTotal.toFixed(2)} seconds exceeds the 15 second limit` });
  }
  if (audioDurationTotal > 15) {
    details.push({ field: 'audio', message: `total audio duration ${audioDurationTotal.toFixed(2)} seconds exceeds the 15 second limit` });
  }

  return details;
};
const normalizeReferenceOrder = (raw: any): RefOrderItem[] => {
  if (!raw) return [];

  let parsed: any = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const out: RefOrderItem[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    if (!['image', 'video', 'audio'].includes(item.type)) continue;

    const index = Number(item.index);
    if (!Number.isFinite(index)) continue;

    out.push({
      index,
      type: item.type as RefType,
      name: typeof item.name === 'string' ? item.name : undefined,
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : undefined,
      lastModified: Number.isFinite(Number(item.lastModified)) ? Number(item.lastModified) : undefined,
    });
  }

  return out.sort((a, b) => a.index - b.index);
};

const buildOrderedMedia = (
  filesMap: { [fieldname: string]: Express.Multer.File[] },
  referenceOrder: RefOrderItem[]
): Array<{ type: RefType; file: Express.Multer.File; index: number }> => {
  const pools: Record<RefType, Express.Multer.File[]> = {
    image: [...(filesMap['image'] || [])],
    video: [...(filesMap['video'] || [])],
    audio: [...(filesMap['audio'] || [])],
  };

  const ordered: Array<{ type: RefType; file: Express.Multer.File; index: number }> = [];

  const consume = (ref: RefOrderItem): Express.Multer.File | null => {
    const pool = pools[ref.type];
    if (!pool.length) return null;

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

  for (const type of ['image', 'video', 'audio'] as RefType[]) {
    for (const file of pools[type]) {
      ordered.push({ type, file, index: Number.MAX_SAFE_INTEGER });
    }
  }

  return ordered;
};

const getMimeExt = (mimeType: string): string => {
  const mime = mimeType.toLowerCase();
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('bmp')) return '.bmp';
  if (mime.includes('tiff')) return '.tiff';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  return '';
};

const makeTempFileFromBuffer = (buffer: Buffer, ext: string, originalName: string): Express.Multer.File => {
  fs.mkdirSync(TEMP_UPLOAD_ROOT, { recursive: true });
  const filename = `${randomUUID()}${ext || '.bin'}`;
  const filePath = path.join(TEMP_UPLOAD_ROOT, filename);
  fs.writeFileSync(filePath, buffer);
  return {
    fieldname: 'response_input',
    originalname: originalName,
    encoding: '7bit',
    mimetype: '',
    destination: 'temp_uploads/',
    filename,
    path: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
    size: buffer.length,
  } as Express.Multer.File;
};

const inferMimeType = (ext: string, type: RefType) => {
  const lower = ext.toLowerCase();
  if (lower === '.jpg' || lower === '.jpeg') return 'image/jpeg';
  if (lower === '.png') return 'image/png';
  if (lower === '.webp') return 'image/webp';
  if (lower === '.gif') return 'image/gif';
  if (lower === '.bmp') return 'image/bmp';
  if (lower === '.tif' || lower === '.tiff') return 'image/tiff';
  if (lower === '.mp4') return 'video/mp4';
  if (lower === '.mov') return 'video/quicktime';
  if (lower === '.mp3') return 'audio/mpeg';
  if (lower === '.wav') return 'audio/wav';
  return type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : 'image/png';
};

const saveResponseInputFile = async (input: string, type: RefType): Promise<Express.Multer.File> => {
  const text = input.trim();
  if (!text) throw httpError(400, 'file input cannot be empty');

  const dataUrl = text.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrl) {
    const mime = dataUrl[1] || '';
    const buffer = Buffer.from(dataUrl[2] || '', 'base64');
    const ext = getMimeExt(mime) || (type === 'video' ? '.mp4' : type === 'audio' ? '.mp3' : '.png');
    const file = makeTempFileFromBuffer(buffer, ext, `input${ext}`);
    file.mimetype = mime || inferMimeType(ext, type);
    return file;
  }

  if (text.startsWith('http://') || text.startsWith('https://')) {
    const response = await axios({ url: text, responseType: 'arraybuffer', timeout: 30000 });
    const mime = String(response.headers?.['content-type'] || '');
    const buffer = Buffer.from(response.data);
    const ext = getMimeExt(mime) || path.extname(new URL(text).pathname) || '.bin';
    const file = makeTempFileFromBuffer(buffer, ext, path.basename(new URL(text).pathname) || `remote-input${ext}`);
    file.mimetype = mime || inferMimeType(ext, type);
    return file;
  }

  const resolved = path.resolve(text);
  if (!fs.existsSync(resolved)) throw httpError(400, `input file does not exist: ${text}`);
  const rel = path.relative(process.cwd(), resolved).replace(/\\/g, '/');
  return {
    fieldname: 'response_input',
    originalname: path.basename(resolved),
    encoding: '7bit',
    mimetype: inferMimeType(path.extname(resolved), type),
    destination: path.dirname(resolved),
    filename: path.basename(resolved),
    path: path.isAbsolute(rel) || rel.startsWith('..') ? resolved : rel,
    size: fs.statSync(resolved).size,
  } as Express.Multer.File;
};

const httpError = (statusCode: number, message: string) => {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  return error;
};

const getHttpStatus = (error: any) => error?.statusCode || error?.status || 500;

const getNoVipStatus = (message: string) => {
  return /vip|member|会员/i.test(message) ? 'NO_VIP' : 'ERROR';
};

const flattenText = (value: any): string[] => {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(item => flattenText(item));
  if (typeof value === 'object') {
    const type = String(value.type || '');
    if (typeof value.text === 'string' && (type === '' || type.includes('text') || type === 'input_text')) return [value.text.trim()].filter(Boolean);
    if (typeof value.content === 'string') return [value.content.trim()].filter(Boolean);
    if (Array.isArray(value.content)) return flattenText(value.content);
    if (Array.isArray(value.input)) return flattenText(value.input);
  }
  return [];
};

const extractResponsesPrompt = (body: any): string => {
  const texts = flattenText(body.input);
  return texts.join('\n').trim();
};

const getInputUrlsByType = (value: any): Array<{ type: RefType; url: string }> => {
  const out: Array<{ type: RefType; url: string }> = [];
  const visit = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;
    const nodeType = String(node.type || '');
    const url = node.image_url || node.video_url || node.audio_url || node.file_url || node.url;
    if (typeof url === 'string') {
      if (nodeType.includes('audio') || node.audio_url) out.push({ type: 'audio', url });
      else if (nodeType.includes('video') || node.video_url) out.push({ type: 'video', url });
      else if (nodeType.includes('image') || node.image_url) out.push({ type: 'image', url });
    }
    if (Array.isArray(node.content)) visit(node.content);
    if (Array.isArray(node.input)) visit(node.input);
  };
  visit(value);
  return out;
};

const getResponsesMetadata = (body: any) => {
  return {
    ...(body?.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
    ...(body?.dreamina && typeof body.dreamina === 'object' ? body.dreamina : {}),
  } as Record<string, any>;
};

const getToolTypes = (body: any): string[] => {
  return Array.isArray(body?.tools)
    ? body.tools.map((tool: any) => String(tool?.type || '').trim()).filter(Boolean)
    : [];
};

const mapTaskStatusToResponseStatus = (status: string) => {
  if (status === 'SUCCESS') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'in_progress';
};

const mapTaskStatusToOpenAIVideoStatus = (status: string) => {
  if (status === 'SUCCESS') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'queued';
};

const buildResponseObject = (task: any) => {
  const responseId = `resp_${task.id}`;
  const status = mapTaskStatusToResponseStatus(task.status);
  const createdAt = Math.floor(new Date(task.createdAt).getTime() / 1000);
  const resultUrl = task.resultUrl || null;
  const isVideo = VIDEO_TASK_TYPES.includes(task.type);
  const outputType = isVideo ? 'dreamina_video_generation_call' : 'image_generation_call';
  const output: any[] = [];

  if (status === 'completed') {
    output.push({
      id: `ig_${task.id}`,
      type: outputType,
      status: 'completed',
      result: resultUrl,
      url: resultUrl,
    });
  } else if (status === 'failed') {
    output.push({
      id: `ig_${task.id}`,
      type: outputType,
      status: 'failed',
      error: task.errorMsg || 'Generation failed',
    });
  }

  const response: any = {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    model: task.model || task.type,
    output,
    output_text: '',
    metadata: {
      task_id: task.id,
      submit_id: task.jimengSubmitId,
      task_type: task.type,
      log_id: task.jimengLogId,
      result_url: resultUrl,
    },
  };

  if (status === 'failed') {
    response.error = { message: task.errorMsg || 'Generation failed' };
  }
  if (task.pollErrorMsg) {
    response.metadata.poll_warning = task.pollErrorMsg;
  }
  return response;
};

const buildResponseObjectFromDispatch = (result: DispatchResult) => ({
  id: `resp_${result.id}`,
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status: 'in_progress',
  model: result.model || result.task_type,
  output: [],
  output_text: '',
  metadata: {
    task_id: result.id,
    submit_id: result.submit_id,
    task_type: result.task_type,
  },
});

const buildOpenAIVideoObject = (task: any) => {
  const status = mapTaskStatusToOpenAIVideoStatus(task.status);
  const createdAt = Math.floor(new Date(task.createdAt).getTime() / 1000);
  const resultUrl = task.resultUrl || null;
  const ratio = task.metadata?.ratio || null;
  const response: any = {
    id: `video_${task.id}`,
    object: 'video',
    created_at: createdAt,
    status,
    model: task.model || task.type,
    progress: status === 'completed' ? 100 : 0,
    seconds: task.metadata?.duration ?? null,
    size: ratio ? RATIO_TO_OPENAI_VIDEO_SIZE[String(ratio)] || null : null,
    metadata: {
      task_id: task.id,
      submit_id: task.jimengSubmitId,
      task_type: task.type,
      log_id: task.jimengLogId,
      result_url: resultUrl,
      dreamina_model: task.model,
    },
  };

  if (status === 'completed') {
    response.result_url = resultUrl;
  }
  if (status === 'failed') {
    response.error = { message: task.errorMsg || 'Video generation failed' };
  }
  if (task.pollErrorMsg) {
    response.metadata.poll_warning = task.pollErrorMsg;
  }
  return response;
};

const buildOpenAIVideoObjectFromDispatch = (result: DispatchResult) => ({
  id: `video_${result.id}`,
  object: 'video',
  created_at: Math.floor(Date.now() / 1000),
  status: 'queued',
  model: result.model || result.task_type,
  progress: 0,
  seconds: null,
  size: null,
  metadata: {
    task_id: result.id,
    submit_id: result.submit_id,
    task_type: result.task_type,
    dreamina_model: result.model,
  },
});

const collectResponsesFiles = async (req: Request, body: any): Promise<{
  filesMap: Record<RefType, Express.Multer.File[]>;
  cleanupFiles: Express.Multer.File[];
}> => {
  const uploaded = (req.files as Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined);
  const { filesMap, files } = normalizeUploadedMediaFiles(uploaded);
  const cleanupFiles: Express.Multer.File[] = [...files];

  const metadata = getResponsesMetadata(body);
  const explicitInputs = [
    ...parseBodyList(metadata.image_urls ?? metadata.images).map(url => ({ type: 'image' as RefType, url })),
    ...parseBodyList(metadata.video_urls ?? metadata.videos).map(url => ({ type: 'video' as RefType, url })),
    ...parseBodyList(metadata.audio_urls ?? metadata.audios).map(url => ({ type: 'audio' as RefType, url })),
    ...getInputUrlsByType(body.input),
  ];

  for (const item of explicitInputs) {
    const file = await saveResponseInputFile(item.url, item.type);
    filesMap[item.type].push(file);
    cleanupFiles.push(file);
  }

  return { filesMap, cleanupFiles };
};

const normalizeResponsesBody = async (req: Request) => {
  const rawBody = req.body || {};
  if (typeof rawBody.payload === 'string') {
    try {
      return { ...rawBody, ...JSON.parse(rawBody.payload) };
    } catch {
      throw httpError(400, 'payload must be valid JSON');
    }
  }
  if (typeof rawBody.request === 'string') {
    try {
      return { ...rawBody, ...JSON.parse(rawBody.request) };
    } catch {
      throw httpError(400, 'request must be valid JSON');
    }
  }
  return rawBody;
};

const createResponsesDispatch = async (req: Request): Promise<DispatchResult> => {
  const body = await normalizeResponsesBody(req);
  const metadata = getResponsesMetadata(body);
  const prompt = getFirstBodyValue(metadata.prompt ?? body.prompt) || extractResponsesPrompt(body);
  const toolTypes = getToolTypes(body);
  const operation = String(metadata.operation || metadata.mode || body.operation || '').trim();
  const normalizedOperation = operation.toLowerCase();
  const { filesMap, cleanupFiles } = await collectResponsesFiles(req, body);
  const imageFiles = filesMap.image || [];
  const videoFiles = filesMap.video || [];
  const audioFiles = filesMap.audio || [];

  const commonBody: Record<string, any> = {
    ...metadata,
    prompt,
    model: metadata.model ?? body.model,
    session: metadata.session,
    ratio: metadata.ratio,
    resolution_type: metadata.resolution_type,
    duration: metadata.duration,
    video_resolution: metadata.video_resolution,
    transition_prompt: metadata.transition_prompt ?? metadata.transition_prompts,
    transition_duration: metadata.transition_duration ?? metadata.transition_durations,
    reference_order: metadata.reference_order,
  };

  try {
    if (normalizedOperation === 'image_upscale' || normalizedOperation === 'upscale') {
      return await dispatchUpscaleTask(req, commonBody, imageFiles[0]);
    }

    const wantsVideo = normalizedOperation.includes('video')
      || toolTypes.includes('dreamina_video_generation')
      || videoFiles.length > 0
      || audioFiles.length > 0
      || Boolean(metadata.video_resolution)
      || Boolean(metadata.duration)
      || ['text2video', 'image2video', 'frames2video', 'multiframe2video', 'multimodal2video'].includes(String(metadata.mode || '').toLowerCase());

    if (wantsVideo) {
      return await dispatchVideoTask(req, { ...commonBody, mode: metadata.mode || operation || 'auto' }, filesMap);
    }

    if (!toolTypes.length || toolTypes.includes('image_generation') || normalizedOperation.includes('image') || imageFiles.length > 0) {
      return await dispatchImageTask(req, commonBody, imageFiles);
    }

    throw httpError(400, 'Responses request must use image_generation, dreamina_video_generation, or metadata.operation.');
  } catch (error) {
    cleanupUploadedFiles(cleanupFiles);
    throw error;
  }
};

const normalizeOpenAIVideoBody = (body: Record<string, any>) => {
  const modelInput = getFirstBodyValue(body.model) || 'seedance2.0fast';
  const model = modelInput.startsWith('jimeng-') ? modelInput : (OPENAI_VIDEO_MODEL_ALIASES[modelInput] || modelInput);
  const size = getFirstBodyValue(body.size);
  const seconds = getFirstBodyValue(body.seconds);
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

  return {
    ...metadata,
    ...body,
    model,
    prompt: getFirstBodyValue(body.prompt ?? body.input) || getFirstBodyValue(metadata.prompt),
    mode: metadata.mode || metadata.operation || body.mode || body.operation || 'auto',
    duration: body.duration ?? seconds ?? metadata.duration,
    ratio: body.ratio ?? metadata.ratio ?? (size ? OPENAI_VIDEO_SIZE_TO_RATIO[size] : undefined),
    video_resolution: body.video_resolution ?? metadata.video_resolution,
    transition_prompt: body.transition_prompt ?? body.transition_prompts ?? metadata.transition_prompt ?? metadata.transition_prompts,
    transition_duration: body.transition_duration ?? body.transition_durations ?? metadata.transition_duration ?? metadata.transition_durations,
    reference_order: body.reference_order ?? metadata.reference_order,
  };
};

const getVideoTaskByPublicId = async (req: Request, rawId: string) => {
  const taskId = rawId.startsWith('video_') ? rawId.slice(6) : rawId;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { account: true, apiKey: true },
  });

  if (!task || task.apiKeyId !== (req as any).apiUserId || !VIDEO_TASK_TYPES.includes(task.type)) {
    return null;
  }
  return task;
};


const dispatchQueuedTask = async (
  req: Request,
  options: {
    command: string;
    type: string;
    model: string | null;
    prompt: string;
  }
): Promise<DispatchResult> => {
  let account: any = null;
  try {
    account = await accountService.getIdleAccount((req as any).apiBoundAccountId);
    if (!account) {
      throw httpError(503, 'All Dreamina accounts are busy or out of credits. Please try again later.');
    }

    console.log(`[Jimeng Dispatcher] Executing: ${options.command}`);

    const dbTask = await prisma.task.create({
      data: {
        apiKeyId: (req as any).apiUserId,
        accountId: account.id,
        type: options.type,
        model: options.model,
        prompt: options.prompt,
      },
    });

    try {
      const { stdout } = await runJimengCommand(options.command, account.homeDir);
      const info = extractSubmitInfo(stdout);
      await prisma.task.update({
        where: { id: dbTask.id },
        data: { status: 'PROCESSING', jimengSubmitId: info.submitId, jimengLogId: info.logId },
      });
      await accountService.releaseAccount(account.id, 'IDLE');

      return {
        id: dbTask.id,
        status: 'processing',
        submit_id: info.submitId,
        task_type: options.type,
        model: options.model,
      };
    } catch (cmdErr: any) {
      await prisma.task.update({
        where: { id: dbTask.id },
        data: { status: 'FAILED', errorMsg: cmdErr.message },
      });
      await accountService.releaseAccount(account.id, getNoVipStatus(cmdErr.message || ''));
      throw httpError(500, 'Jimeng CLI failed: ' + cmdErr.message);
    }
  } catch (error: any) {
    if (account && getHttpStatus(error) !== 500) {
      try { await accountService.releaseAccount(account.id, 'IDLE'); } catch {}
    }
    throw error;
  }
};

const dispatchImageTask = async (
  req: Request,
  body: Record<string, any>,
  files: Express.Multer.File[]
): Promise<DispatchResult> => {
  try {
    const hasImages = files.length > 0;
    const prompt = getFirstBodyValue(body.prompt);
    const modelAlias = resolveImageModelAlias(body.model);
    const rawModel = getFirstBodyValue(body.model);
    const model = modelAlias?.cli_model || rawModel || '5.0';
    const publicModel = modelAlias?.id || model;
    const resolutionType = getFirstBodyValue(body.resolution_type);
    const ratio = getFirstBodyValue(body.ratio) || '1:1';
    const sessionParam = buildSessionParam(body.session);

    if (!prompt && !hasImages) {
      throw httpError(400, "Either 'prompt' or an 'image' file is required.");
    }
    if (!IMAGE_RATIOS.has(ratio)) {
      throw httpError(400, 'ratio must be one of 21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16');
    }

    let command = '';
    let dbTaskType = '';
    if (hasImages) {
      if (files.length > 10) throw httpError(400, 'images must not exceed 10 files');
      if (!IMAGE2IMAGE_MODELS.has(model)) throw httpError(400, `model ${publicModel} is not supported for image2image`);
      if (resolutionType && !IMAGE2IMAGE_RESOLUTIONS.has(resolutionType)) {
        throw httpError(400, 'resolution_type for image2image must be 2k or 4k');
      }
      const imagePathsCsv = files.map(getCliFilePath).join(',');
      const resParam = resolutionType ? ` --resolution_type=${resolutionType}` : '';
      command = `dreamina image2image --images=${shellQuote(imagePathsCsv)} --prompt=${shellQuote(prompt || '')} --ratio=${ratio} --model_version=${model}${resParam} ${sessionParam} --poll=0`;
      dbTaskType = 'image2image';
    } else {
      const allowed = TEXT2IMAGE_RESOLUTIONS_BY_MODEL.get(model);
      if (!allowed) throw httpError(400, `model ${publicModel} is not supported for text2image`);
      if (resolutionType && !allowed.has(resolutionType)) {
        throw httpError(400, `resolution_type for model ${publicModel} must be one of ${Array.from(allowed).join(', ')}`);
      }
      const resParam = resolutionType ? ` --resolution_type=${resolutionType}` : '';
      command = `dreamina text2image --prompt=${shellQuote(prompt || '')} --ratio=${ratio} --model_version=${model}${resParam} ${sessionParam} --poll=0`;
      dbTaskType = 'text2image';
    }

    return await dispatchQueuedTask(req, {
      command,
      type: dbTaskType,
      model: publicModel,
      prompt: prompt || '',
    });
  } finally {
    cleanupUploadedFiles(files);
  }
};

const dispatchUpscaleTask = async (
  req: Request,
  body: Record<string, any>,
  file: Express.Multer.File | undefined
): Promise<DispatchResult> => {
  try {
    if (!file) throw httpError(400, 'image file is required');
    const modelAlias = resolveUpscaleModelAlias(body.model);
    const aliasId = modelAlias?.id;
    const aliasResolution = modelAlias ? UPSCALE_ALIAS_TO_RESOLUTION[modelAlias.id] : undefined;
    const requestedResolution = getFirstBodyValue(body.resolution_type);
    if (aliasResolution && requestedResolution && requestedResolution !== aliasResolution) {
      throw httpError(400, `model ${aliasId} only supports resolution_type=${aliasResolution}`);
    }
    const resolutionType = requestedResolution || aliasResolution || '2k';
    if (!UPSCALE_RESOLUTIONS.has(resolutionType)) {
      throw httpError(400, 'resolution_type must be one of 2k, 4k, 8k');
    }

    const sessionParam = buildSessionParam(body.session);
    const imagePath = getCliFilePath(file);
    const command = `dreamina image_upscale --image=${shellQuote(imagePath)} --resolution_type=${resolutionType} ${sessionParam} --poll=0`;

    return await dispatchQueuedTask(req, {
      command,
      type: 'image_upscale',
      model: aliasId || 'image_upscale',
      prompt: `upscale:${resolutionType}`,
    });
  } finally {
    cleanupUploadedFile(file);
  }
};

const dispatchVideoTask = async (
  req: Request,
  body: Record<string, any>,
  filesMap: { [fieldname: string]: Express.Multer.File[] }
): Promise<DispatchResult> => {
  const allFiles: Express.Multer.File[] = [
    ...(filesMap.image || []),
    ...(filesMap.audio || []),
    ...(filesMap.video || []),
  ];

  try {
    const prompt = getFirstBodyValue(body.prompt);
    const rawModel = getFirstBodyValue(body.model);
    const modelAlias = resolveVideoModelAlias(rawModel);
    const modelProvided = rawModel !== undefined && !modelAlias;
    const model = normalizeVideoModelVersion(modelAlias?.cli_model || rawModel || 'seedance2.0fast');
    const modeInput = body.mode ?? body.task_type ?? body.command ?? body.video_mode ?? aliasDefaultMode(modelAlias);
    const requestedMode = normalizeVideoMode(modeInput);
    const durationRaw = getFirstBodyValue(body.duration);
    const ratioInput = getFirstBodyValue(body.ratio);
    const videoResolution = getFirstBodyValue(body.video_resolution);
    const transitionPromptsRaw = parseBodyList(body.transition_prompt ?? body.transition_prompts);
    const transitionDurationsRaw = parseBodyList(body.transition_duration ?? body.transition_durations);
    const sessionParam = buildSessionParam(body.session);

    if (requestedMode === null) {
      throw httpError(400, 'mode must be one of auto, text2video, image2video, frames2video, multiframe2video, multimodal2video');
    }

    const referenceOrder = normalizeReferenceOrder(body.reference_order);
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

    const autoMode: VideoMode = !hasMedia
      ? 'text2video'
      : (hasVideos || hasAudio)
        ? 'multimodal2video'
        : imageCount === 1
          ? 'image2video'
          : imageCount === 2
            ? 'multimodal2video'
            : 'multiframe2video';
    const mode: VideoMode = requestedMode === 'auto' ? autoMode : requestedMode;
    const publicModel = modelAlias?.id || (mode === 'multiframe2video' ? 'jimeng-video-keyframes' : model);

    if (hasAudio && !hasImages && !hasVideos) {
      throw httpError(400, 'Audio-only reference is not supported. Please upload at least one image or one video when using audio reference.');
    }
    if (mode === 'text2video') {
      if (hasMedia) throw httpError(400, 'text2video does not accept image, video, or audio references.');
      if (!prompt) throw httpError(400, 'prompt is required for text2video.');
      if (!TEXT2VIDEO_MODELS.has(model)) throw httpError(400, `model ${publicModel} is not supported for text2video.`);
    }
    if (mode === 'image2video') {
      if (imageCount !== 1 || hasVideos || hasAudio) throw httpError(400, 'image2video requires exactly 1 image and does not accept video or audio references.');
      if (!IMAGE2VIDEO_MODELS.has(model)) throw httpError(400, `model ${publicModel} is not supported for image2video.`);
    }
    if (mode === 'frames2video') {
      if (imageCount !== 2 || hasVideos || hasAudio) throw httpError(400, 'frames2video requires exactly 2 images and does not accept video or audio references.');
      if (!FRAMES2VIDEO_MODELS.has(model)) throw httpError(400, `model ${publicModel} is not supported for frames2video.`);
    }
    if (mode === 'multiframe2video') {
      if (imageCount < 2 || hasVideos || hasAudio) throw httpError(400, 'multiframe2video requires 2 to 20 images and does not accept video or audio references.');
      if (modelProvided) throw httpError(400, 'multiframe2video does not support model_version. Remove model or choose another video mode.');
      if (modelAlias && modelAlias.kind !== 'video_keyframes') throw httpError(400, 'multiframe2video must use jimeng-video-keyframes or omit model.');
      if (videoResolution) throw httpError(400, 'multiframe2video does not support video_resolution.');
      if (ratioInput) throw httpError(400, 'multiframe2video does not support ratio.');
      if (imageCount === 2) {
        if (transitionPromptsRaw.length > 0 || transitionDurationsRaw.length > 0) {
          throw httpError(400, 'For exactly 2 images, use prompt and optional duration only. transition_prompt and transition_duration are for 3+ images.');
        }
        if (!prompt) throw httpError(400, 'prompt is required for exactly 2 images in multiframe2video.');
      } else if (durationRaw !== undefined) {
        throw httpError(400, 'duration is only supported as shorthand for exactly 2 images in multiframe2video.');
      }
    }
    if (mode === 'multimodal2video') {
      if (!hasImages && !hasVideos) throw httpError(400, 'multimodal2video requires at least one image or one video reference.');
      if (!MULTIMODAL_MODELS.has(model)) throw httpError(400, `model ${publicModel} is not supported for multimodal2video.`);
      if (imageCount > 9) throw httpError(400, 'multimodal2video supports up to 9 images.');
      if (videoCount > 3) throw httpError(400, 'multimodal2video supports up to 3 videos.');
      if (audioCount > 3) throw httpError(400, 'multimodal2video supports up to 3 audio files.');
    }

    if (mode === 'multimodal2video' && model.includes('seedance2.0')) {
      const validationDetails = await validateSeedance2Inputs(orderedMedia);
      if (validationDetails.length > 0) {
        throw httpError(400, `Seedance 2.0 input validation failed: ${validationDetails.map(item => item.message).join('; ')}`);
      }
    }

    if (mode === 'text2video' || mode === 'multimodal2video') {
      const ratio = ratioInput || '16:9';
      if (ratioInput && !VIDEO_RATIOS.has(ratioInput)) {
        throw httpError(400, 'ratio must be one of 1:1, 3:4, 16:9, 4:3, 9:16, 21:9');
      }
      const duration = durationRaw === undefined ? 5 : parseIntegerField(durationRaw);
      if (duration === null) throw httpError(400, 'duration must be an integer');
      const [minDuration, maxDuration] = getVideoDurationRange(mode, model);
      if (duration < minDuration || duration > maxDuration) {
        throw httpError(400, `duration for ${mode} with model ${publicModel} must be between ${minDuration} and ${maxDuration} seconds`);
      }
      if (videoResolution) {
        const allowed = getVideoResolutionValues(mode, model);
        if (!allowed.has(videoResolution)) {
          throw httpError(400, `video_resolution for model ${publicModel} must be one of ${Array.from(allowed).join(', ')}`);
        }
      }
    }

    if (mode === 'image2video' || mode === 'frames2video') {
      if (ratioInput) throw httpError(400, `${mode} does not support ratio.`);
      const duration = durationRaw === undefined ? 5 : parseIntegerField(durationRaw);
      if (duration === null) throw httpError(400, 'duration must be an integer');
      const [minDuration, maxDuration] = getVideoDurationRange(mode, model);
      if (duration < minDuration || duration > maxDuration) {
        throw httpError(400, `duration for ${mode} with model ${publicModel} must be between ${minDuration} and ${maxDuration} seconds`);
      }
      if (videoResolution) {
        const allowed = getVideoResolutionValues(mode, model);
        if (!allowed.has(videoResolution)) {
          throw httpError(400, `video_resolution for model ${publicModel} must be one of ${Array.from(allowed).join(', ')}`);
        }
      }
    }

    if (mode === 'multiframe2video') {
      if (imageCount === 2) {
        const segmentDuration = durationRaw === undefined ? 3 : parseFloatField(durationRaw);
        if (segmentDuration === null) throw httpError(400, 'duration must be a number');
        if (segmentDuration < 0.5 || segmentDuration > 8) {
          throw httpError(400, 'duration for multiframe2video must be between 0.5 and 8 seconds per segment');
        }
      } else {
        const transitionCount = imageCount - 1;
        const prompts = transitionPromptsRaw.length > 0 ? transitionPromptsRaw : (prompt ? Array.from({ length: transitionCount }, () => prompt) : []);
        if (prompts.length !== transitionCount) {
          throw httpError(400, `transition_prompt must contain exactly ${transitionCount} values for ${imageCount} images, or provide prompt shorthand.`);
        }
        const durations = transitionDurationsRaw.length > 0
          ? transitionDurationsRaw.map(value => Number(value))
          : Array.from({ length: transitionCount }, () => 3);
        if (durations.length !== transitionCount) {
          throw httpError(400, `transition_duration must contain exactly ${transitionCount} values for ${imageCount} images.`);
        }
        for (const segmentDuration of durations) {
          if (!Number.isFinite(segmentDuration) || segmentDuration < 0.5 || segmentDuration > 8) {
            throw httpError(400, 'each transition_duration must be between 0.5 and 8 seconds');
          }
        }
        const totalDuration = durations.reduce((sum, value) => sum + value, 0);
        if (totalDuration < 2) throw httpError(400, 'total duration for multiframe2video must be at least 2 seconds');
      }
    }

    let command = '';
    let dbModel: string | null = publicModel;

    if (mode === 'multimodal2video') {
      const mediaArgs = orderedMedia.map(item => {
        const mediaPath = getCliFilePath(item.file);
        if (item.type === 'image') return `--image=${shellQuote(mediaPath)}`;
        if (item.type === 'video') return `--video=${shellQuote(mediaPath)}`;
        return `--audio=${shellQuote(mediaPath)}`;
      }).join(' ');
      const ratio = ratioInput || '16:9';
      const duration = durationRaw === undefined ? 5 : Number(durationRaw);
      const promptParam = prompt ? ` --prompt=${shellQuote(prompt)}` : '';
      const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
      command = `dreamina multimodal2video ${mediaArgs}${promptParam} --model_version=${model} --duration=${duration} --ratio=${ratio}${videoResolutionParam} ${sessionParam} --poll=0`;
    } else if (mode === 'frames2video') {
      const firstPath = getCliFilePath(imageMedia[0].file);
      const lastPath = getCliFilePath(imageMedia[1].file);
      const duration = durationRaw === undefined ? 5 : Number(durationRaw);
      const promptParam = prompt ? ` --prompt=${shellQuote(prompt)}` : '';
      const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
      command = `dreamina frames2video --first=${shellQuote(firstPath)} --last=${shellQuote(lastPath)}${promptParam} --model_version=${model} --duration=${duration}${videoResolutionParam} ${sessionParam} --poll=0`;
    } else if (mode === 'multiframe2video') {
      const imagePathCsv = imageMedia.map(item => getCliFilePath(item.file)).join(',');
      const imagePaths = `--images=${shellQuote(imagePathCsv)}`;
      if (imageCount === 2) {
        const duration = durationRaw === undefined ? 3 : parseFloatField(durationRaw);
        command = `dreamina multiframe2video ${imagePaths} --prompt=${shellQuote(prompt || '')} --duration=${duration} ${sessionParam} --poll=0`;
      } else {
        const transitionCount = imageCount - 1;
        const prompts = transitionPromptsRaw.length > 0 ? transitionPromptsRaw : Array.from({ length: transitionCount }, () => prompt || '');
        const durations = transitionDurationsRaw.length > 0
          ? transitionDurationsRaw.map(value => Number(value))
          : Array.from({ length: transitionCount }, () => 3);
        const transitionPromptArgs = prompts.map(value => `--transition-prompt=${shellQuote(value)}`).join(' ');
        const transitionDurationArgs = durations.map(value => `--transition-duration=${value}`).join(' ');
        command = `dreamina multiframe2video ${imagePaths} ${transitionPromptArgs} ${transitionDurationArgs} ${sessionParam} --poll=0`;
      }
      dbModel = publicModel;
    } else if (mode === 'image2video') {
      const imagePath = getCliFilePath(imageMedia[0].file);
      const duration = durationRaw === undefined ? 5 : Number(durationRaw);
      const promptParam = prompt ? ` --prompt=${shellQuote(prompt)}` : '';
      const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
      command = `dreamina image2video --image=${shellQuote(imagePath)}${promptParam} --model_version=${model} --duration=${duration}${videoResolutionParam} ${sessionParam} --poll=0`;
    } else {
      const duration = durationRaw === undefined ? 5 : Number(durationRaw);
      const ratio = ratioInput || '16:9';
      const videoResolutionParam = videoResolution ? ` --video_resolution=${videoResolution}` : '';
      command = `dreamina text2video --prompt=${shellQuote(prompt || '')} --ratio=${ratio} --model_version=${model} --duration=${duration}${videoResolutionParam} ${sessionParam} --poll=0`;
    }

    return await dispatchQueuedTask(req, {
      command,
      type: mode,
      model: dbModel,
      prompt: prompt || '',
    });
  } finally {
    cleanupUploadedFiles(allFiles);
  }
};

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

function extractSubmitInfo(stdout: string): { submitId: string; logId: string | null } {
  let submitId = '';
  let logId: string | null = null;
  try {
    const jsonStr = stdout.substring(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
    const result = JSON.parse(jsonStr);
    submitId = result.submit_id || result.task_id || result.data?.submit_id || '';
    logId = result.logid || result.log_id || result.data?.logid || null;
  } catch (e) {}

  if (!submitId) {
    const idMatch = stdout.match(/(?:submit_id|task_id|tid|id)["':\s=]+([a-zA-Z0-9_\-]+)/i);
    if (idMatch && idMatch[1]) submitId = idMatch[1];
    else {
      const plainMatch = stdout.match(/\b([a-fA-F0-9]{16})\b/);
      if (plainMatch && plainMatch[1]) submitId = plainMatch[1];
      else throw new Error("Cannot find submit_id in CLI output.\nRaw Output: " + stdout.substring(0, 500));
    }
  }

  if (!logId) {
    const logMatch = stdout.match(/logid["':\s=]+([a-zA-Z0-9_\-]+)/i);
    if (logMatch && logMatch[1]) logId = logMatch[1];
  }

    return { submitId, logId };
}

router.get('/models', apiKeyAuth, (_req: Request, res: Response) => {
  res.json({
    object: 'list',
    global_capabilities: {
      multiframe2video: true,
    },
    global_parameters: GLOBAL_MODE_PARAMETERS,
    naming: {
      recommended_prefix: 'jimeng-',
      rule: 'Use jimeng-* models for Dreamina routing. Legacy raw Dreamina model ids are still accepted for compatibility.',
    },
    data: publicModelList(),
  });
});

router.post('/responses', apiKeyAuth, responsesUpload.any(), async (req: Request, res: Response) => {
  try {
    const result = await createResponsesDispatch(req);
    return res.json(buildResponseObjectFromDispatch(result));
  } catch (error: any) {
    return res.status(getHttpStatus(error)).json({ error: { message: error.message } });
  }
});

router.get('/responses/:id', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const rawId = String(req.params.id || '');
    const taskId = rawId.startsWith('resp_') ? rawId.slice(5) : rawId;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { account: true, apiKey: true },
    });

    if (!task || task.apiKeyId !== (req as any).apiUserId) {
      return res.status(404).json({ error: { message: 'Response not found' } });
    }

    return res.json(buildResponseObject(task));
  } catch (error: any) {
    return res.status(500).json({ error: { message: error.message } });
  }
});

router.post('/videos', apiKeyAuth, upload.any(), async (req: Request, res: Response) => {
  try {
    const { filesMap } = normalizeUploadedMediaFiles(req.files as Express.Multer.File[] | undefined);
    const body = normalizeOpenAIVideoBody(req.body || {});
    const result = await dispatchVideoTask(req, body, filesMap);
    return res.json(buildOpenAIVideoObjectFromDispatch(result));
  } catch (err: any) {
    return res.status(getHttpStatus(err)).json({ error: { message: err.message } });
  }
});

router.get('/videos/:id', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const task = await getVideoTaskByPublicId(req, String(req.params.id || ''));
    if (!task) return res.status(404).json({ error: { message: 'Video not found' } });
    return res.json(buildOpenAIVideoObject(task));
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message } });
  }
});

router.get('/videos/:id/content', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const task = await getVideoTaskByPublicId(req, String(req.params.id || ''));
    if (!task) return res.status(404).json({ error: { message: 'Video not found' } });
    if (task.status !== 'SUCCESS' || !task.resultUrl) {
      return res.status(409).json({ error: { message: 'Video is not ready' } });
    }
    return res.redirect(task.resultUrl);
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message } });
  }
});

router.post('/images/generations', apiKeyAuth, upload.array('images', 10), async (req: Request, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    const result = await dispatchImageTask(req, req.body, files);
    return res.json({ id: result.id, status: result.status, submit_id: result.submit_id });
  } catch (err: any) {
    return res.status(getHttpStatus(err)).json({ error: { message: err.message } });
  }
});
router.post('/images/upscale', apiKeyAuth, upload.single('image'), async (req: Request, res: Response) => {
  try {
    const result = await dispatchUpscaleTask(req, req.body, req.file as Express.Multer.File | undefined);
    return res.json({ id: result.id, status: result.status, submit_id: result.submit_id });
  } catch (err: any) {
    return res.status(getHttpStatus(err)).json({ error: { message: err.message } });
  }
});
router.post('/videos/generations', apiKeyAuth, upload.any(), async (req: Request, res: Response) => {
  try {
    const { filesMap } = normalizeUploadedMediaFiles(req.files as Express.Multer.File[] | undefined);
    const result = await dispatchVideoTask(req, req.body, filesMap);
    return res.json({ id: result.id, status: result.status, submit_id: result.submit_id });
  } catch (err: any) {
    return res.status(getHttpStatus(err)).json({ error: { message: err.message } });
  }
});
router.get('/tasks/:id', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { account: true, apiKey: true }
    });

    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    if (task.apiKeyId !== (req as any).apiUserId) return res.status(404).json({ error: { message: "Task not found" } });

    // Database polling mode - purely return what's in DB
    if (task.status === "SUCCESS") {
      return res.json({ id: task.id, status: "success", data: [{ url: task.resultUrl }] });
    }
    if (task.status === "FAILED") {
      return res.json({ id: task.id, status: "failed", error: task.errorMsg || "Generation failed" });
    }

    // If it's PENDING or PROCESSING, just return processing. The daemon handles the CLI.
    // Surface polling warnings without marking the queued Dreamina task as failed.
    const response: any = { id: task.id, status: "processing" };
    if ((task as any).pollErrorMsg) {
      response.poll_warning = (task as any).pollErrorMsg;
    }
    return res.json(response);
  } catch (err: any) {
    console.error("Error checking task ID:", req.params.id, err);
    res.status(500).json({ error: { message: "Internal server error" } });
  }
});

export default router;
