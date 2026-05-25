# 即梦 CLI OpenAI 兼容接口文档

本文档对应当前服务的 `/v1` 接口。服务端负责维护即梦 CLI 登录账号、轮询账号、提交任务和查询结果；客户端只需要使用 API Key 调用 OpenAI 风格接口或传统 form-data 接口。

## 1. 接入基础

Base URL:

```text
http://<server>:3000/v1
```

鉴权 Header:

```text
Authorization: Bearer sk-jm-...
```

建议先调用模型列表验证 Key 和服务状态:

```bash
curl http://<server>:3000/v1/models \
  -H "Authorization: Bearer sk-jm-..."
```

核心规则:

- 模型是模型，功能由 `mode` 或 `metadata.mode` 决定。
- 推荐新接入使用 `jimeng-*` 模型 ID。
- 兼容旧模型 ID 和旧功能别名，但不建议新项目继续依赖。
- 参数错误返回 `400` 和明确 `error.message`，服务端不会自动降级模型。

## 2. 推荐模型

图片模型:

```text
jimeng-image-3.0
jimeng-image-3.1
jimeng-image-4.0
jimeng-image-4.1
jimeng-image-4.5
jimeng-image-4.6
jimeng-image-5.0
```

视频模型:

```text
jimeng-video-3.0
jimeng-video-3.0fast
jimeng-video-3.0pro
jimeng-video-3.5pro
jimeng-video-seedance2.0
jimeng-video-seedance2.0fast
jimeng-video-seedance2.0_vip
jimeng-video-seedance2.0fast_vip
```

放大模型:

```text
jimeng-upscale
```

兼容别名仍可识别，例如 `jimeng-video-frames-*`、`jimeng-video-multimodal-*`、`jimeng-video-keyframes`、原始 CLI 模型 ID、`jimeng-upscale-4k` 等。推荐新接入只展示主模型，把功能选择放到 `mode`。

## 3. 接口总览

| 接口 | 用途 | 轮询 |
| --- | --- | --- |
| `GET /v1/models` | 获取推荐模型、能力、兼容旧模型 | 不需要 |
| `POST /v1/responses` | OpenAI Responses 风格入口，支持生图、生视频、放大 | `GET /v1/responses/:id` |
| `POST /v1/videos` | OpenAI Videos 风格入口 | `GET /v1/videos/:id` |
| `POST /v1/images/generations` | 传统 form-data 生图、图生图 | `GET /v1/tasks/:id` |
| `POST /v1/videos/generations` | 传统 form-data 生视频，最贴近 CLI | `GET /v1/tasks/:id` |
| `POST /v1/images/upscale` | 高清放大 | `GET /v1/tasks/:id` |

## 4. 视频 mode 路由

| mode | CLI 功能 | 输入要求 |
| --- | --- | --- |
| `auto` | 自动判断 | 无媒体为文生视频；1 图为图生视频；2 图默认多模态；3 图及以上默认多关键帧 |
| `text2video` | `dreamina text2video` | 只有 prompt，不接受图片、视频、音频 |
| `image2video` | `dreamina image2video` | 恰好 1 张图片 |
| `frames2video` | `dreamina frames2video` | 恰好 2 张图片，表示首帧和尾帧 |
| `multimodal2video` | `dreamina multimodal2video` | 图片、视频、音频引用组合，适合 Seedance 2.0 系列 |
| `multiframe2video` | `dreamina multiframe2video` | 2 到 20 张关键帧，不支持 `model_version`、`ratio`、`video_resolution` |

两张图片有歧义: 可能是“多图参考”，也可能是“首尾帧”。如果你要首尾帧，必须显式传 `mode=frames2video`。

## 5. OpenAI SDK 示例

### 5.1 Responses 文生图

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-jm-...",
  baseURL: "http://<server>:3000/v1",
});

const resp = await client.responses.create({
  model: "jimeng-image-5.0",
  input: "一张电影感机械猫肖像",
  tools: [{ type: "image_generation" }],
  metadata: {
    ratio: "1:1",
    resolution_type: "2k"
  }
});

const latest = await client.responses.retrieve(resp.id);
```

### 5.2 Responses 文生视频

```ts
const resp = await client.responses.create({
  model: "jimeng-video-seedance2.0fast",
  input: "城市夜景，镜头缓慢推进",
  metadata: {
    mode: "text2video",
    duration: 5,
    ratio: "16:9",
    video_resolution: "720p"
  }
});

const latest = await client.responses.retrieve(resp.id);
```

### 5.3 Videos 风格

```ts
const video = await client.videos.create({
  model: "jimeng-video-seedance2.0fast",
  prompt: "城市夜景，镜头缓慢推进",
  seconds: 5,
  size: "1280x720",
  metadata: {
    mode: "text2video"
  }
});

const latest = await client.videos.retrieve(video.id);
```

### 5.4 Responses 高清放大

```ts
const resp = await client.responses.create({
  model: "jimeng-upscale",
  input: "放大这张图片",
  metadata: {
    operation: "image_upscale",
    image_urls: ["https://example.com/input.png"],
    resolution_type: "4k"
  }
});
```

## 6. dry-run 调试

生成类接口都支持 dry-run。它只做鉴权、参数校验、功能路由和命令构建，不提交 CLI，不消耗积分。

使用 Header:

```text
X-Jimeng-Dry-Run: 1
```

也可以使用 query:

```text
?dry_run=1
```

示例:

```bash
curl -X POST http://<server>:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -H "X-Jimeng-Dry-Run: 1" \
  -F "model=jimeng-video-seedance2.0fast" \
  -F "mode=frames2video" \
  -F "prompt=从白天过渡到夜晚" \
  -F "image=@first.jpg" \
  -F "image=@last.jpg" \
  -F "duration=5"
```

返回会包含实际 CLI 命令:

```json
{
  "status": "completed",
  "dry_run": true,
  "task_type": "frames2video",
  "model": "jimeng-video-seedance2.0fast",
  "command": "dreamina frames2video ..."
}
```

## 7. 传统 form-data 示例

### 7.1 文生图

```bash
curl -X POST http://<server>:3000/v1/images/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-image-5.0" \
  -F "prompt=一张电影感机械猫肖像" \
  -F "ratio=16:9" \
  -F "resolution_type=2k"
```

图生图追加 `images` 文件，最多 10 张:

```bash
curl -X POST http://<server>:3000/v1/images/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-image-5.0" \
  -F "prompt=保留主体，改成赛博朋克风格" \
  -F "images=@reference.jpg"
```

### 7.2 文生视频

```bash
curl -X POST http://<server>:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-video-seedance2.0fast" \
  -F "mode=text2video" \
  -F "prompt=城市夜景，镜头缓慢推进" \
  -F "duration=5" \
  -F "ratio=16:9" \
  -F "video_resolution=720p"
```

### 7.3 图生视频

```bash
curl -X POST http://<server>:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-video-seedance2.0fast" \
  -F "mode=image2video" \
  -F "prompt=让角色缓慢转身" \
  -F "image=@face.jpg" \
  -F "duration=5"
```

### 7.4 首尾帧视频

```bash
curl -X POST http://<server>:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-video-seedance2.0fast" \
  -F "mode=frames2video" \
  -F "prompt=从白天过渡到夜晚" \
  -F "image=@first.jpg" \
  -F "image=@last.jpg" \
  -F "duration=5"
```

### 7.5 多模态视频

```bash
curl -X POST http://<server>:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-video-seedance2.0fast" \
  -F "mode=multimodal2video" \
  -F "prompt=人物跟随音频自然说话" \
  -F "image=@face.jpg" \
  -F "audio=@voice.mp3" \
  -F "duration=8" \
  -F "ratio=16:9"
```

### 7.6 多关键帧视频

```bash
curl -X POST http://<server>:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-video-keyframes" \
  -F "mode=multiframe2video" \
  -F "image=@a.jpg" \
  -F "image=@b.jpg" \
  -F "image=@c.jpg" \
  -F "transition_prompt=镜头推进" \
  -F "transition_prompt=切到夜景" \
  -F "transition_duration=3" \
  -F "transition_duration=3"
```

### 7.7 高清放大

```bash
curl -X POST http://<server>:3000/v1/images/upscale \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-upscale" \
  -F "image=@input.jpg" \
  -F "resolution_type=4k"
```

## 8. 返回结构

传统任务提交:

```json
{
  "id": "clxxxx",
  "status": "processing",
  "submit_id": "dreamina_submit_id",
  "task_type": "text2image",
  "model": "jimeng-image-5.0"
}
```

传统任务轮询成功:

```json
{
  "id": "clxxxx",
  "status": "success",
  "data": [
    { "url": "https://..." }
  ]
}
```

传统任务轮询失败:

```json
{
  "id": "clxxxx",
  "status": "failed",
  "error": "失败原因"
}
```

Responses 和 Videos 接口会把同一个任务包装成 OpenAI 风格对象，同时在 `metadata.task_id` 中保留内部任务 ID。

## 9. 常见错误

| 错误 | 原因 | 处理方式 |
| --- | --- | --- |
| `Missing Authorization header` | 没带 Bearer Token | 补齐 `Authorization` Header |
| `Invalid API Key` | Key 不存在或已停用 | 在管理页重新签发或启用 |
| `mode must be one of ...` | mode 写错 | 使用文档列出的 mode |
| `image2video requires exactly 1 image` | 图生视频图片数量不对 | 只传 1 张图，或改用其他 mode |
| `frames2video requires exactly 2 images` | 首尾帧不是 2 张图 | 传首帧和尾帧两张图 |
| `multiframe2video does not support model_version` | 多关键帧不接受普通视频模型版本 | 使用 `jimeng-video-keyframes` 或不传 model |
| `duration ... must be between ...` | 时长超过模型范围 | 按错误信息调整 duration |

## 10. 给中转站的建议

- 对外只展示推荐模型，不展示兼容旧模型。
- UI 上把“模型”和“功能”分开，功能对应 `mode`。
- 两张图时让用户选择“多图参考”还是“首尾帧”。
- 上线前用 `X-Jimeng-Dry-Run: 1` 批量验证路由和参数。
- 不建议自动降级模型；应把 400 错误原样返回给调用方，方便用户修正参数。
