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
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=openai.d.ts.map