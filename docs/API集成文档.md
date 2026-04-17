# 即梦 API 集成文档

> 本服务将 Jimeng CLI 包装为 OpenAI 兼容接口，所有请求格式与 OpenAI 一致，可直接接入支持自定义 endpoint 的客户端。

---

## 全局规范

| 项目 | 说明 |
|------|------|
| Base URL | `http://<server-ip>:3000/v1` |
| 认证 | `Authorization: Bearer sk-jm-xxxxxxxxxx` |
| 请求格式 | `multipart/form-data`（所有生成接口） |
| 任务模式 | **异步**：POST 立即返回任务 ID，需轮询 GET /v1/tasks/:id |

---

## 异步任务响应机制（必读）

本服务所有生成任务均为**异步模式**：POST 立即返回任务 ID，结果需通过轮询获取。

### 任务状态机

```
PENDING → PROCESSING → SUCCESS
                    ↘ FAILED
```

| 状态 | 含义 |
|------|------|
| `pending` | 任务已入库，等待提交至火山 |
| `processing` | 已提交至火山，正在生成中 |
| `success` | 火山明确返回成功，结果 URL 已就绪 |
| `failed` | **火山明确返回失败**（如内容违规、账号异常等），见 `error` 字段 |

> ⚠️ **重要**：`failed` 状态仅在火山服务器明确告知失败时设置。
> 我方网络问题**不会**将任务标为 `failed`，见下方 `poll_warning` 说明。

---

### ① POST 提交 → 立即返回

```json
{
  "id": "clxxxxxxxxxxx",
  "status": "processing",
  "submit_id": "abc123"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 本服务任务 ID，用于后续轮询 |
| `status` | string | 固定为 `"processing"` |
| `submit_id` | string | 火山原生任务 ID（仅供参考） |

---

### ② 轮询（GET /v1/tasks/:id）

**建议轮询间隔：图片 5s，视频 15s**。视频生成通常需 1–5 分钟。

**情形 A：生成中（正常）**
```json
{ "id": "clxxx", "status": "processing" }
```

**情形 B：生成中（我方轮询遭遇网络抖动）**
```json
{
  "id": "clxxx",
  "status": "processing",
  "poll_warning": "[2026-04-17T12:00:00.000Z] 我方网络异常，轮询暂时中断，任务仍在火山排队。错误: connect ETIMEDOUT"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 仍为 `"processing"` — 任务**没有失败**，火山仍在生成 |
| `poll_warning` | string? | **仅我方网络问题时出现**，包含时间戳和具体网络错误。**不代表任务失败，无需重新提交**，继续轮询即可，网络恢复后自动清除 |

> 客户端处理建议：存在 `poll_warning` 时，可在 UI 上显示"网络延迟，继续等待..."，**不要中止轮询、不要重复提交任务**。

**情形 C：成功**
```json
{
  "id": "clxxx",
  "status": "success",
  "data": [{ "url": "https://cdn.xxx/output.mp4" }]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `"success"` |
| `data[0].url` | string | 结果文件 URL（图片为图片链接，视频为 mp4 链接） |

**情形 D：失败（火山明确返回）**
```json
{
  "id": "clxxx",
  "status": "failed",
  "error": "火山服务返回失败。状态: failed. 原始: ..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `"failed"` |
| `error` | string | 失败原因，来源于火山服务器的原始回复 |

---

### 错误响应（HTTP 4xx/5xx）

| HTTP 状态 | 场景 | 响应体 |
|-----------|------|--------|
| 401 | API Key 无效或未激活 | `{ "error": { "message": "Invalid API key" } }` |
| 400 | 缺少必填参数（如 prompt） | `{ "error": { "message": "Either 'prompt' or an 'image' file is required." } }` |
| 503 | 当前所有账号繁忙，稍后重试 | `{ "error": { "message": "All Dreamina accounts are busy..." } }` |
| 500 | 服务内部错误（CLI 执行失败等） | `{ "error": { "message": "Jimeng CLI failed: ..." } }` |
| 404 | 任务不存在或不属于当前 API Key | `{ "error": { "message": "Task not found" } }` |

---

## 接口1：图片生成

```
POST /v1/images/generations
```

### Form-Data 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `prompt` | ✅ | 画面描述提示词 |
| `model` | | 模型版本，默认 `5.0` |
| `ratio` | | 画幅比例，如 `16:9`、`1:1`、`9:16` |
| `resolution_type` | | `4k` / `2k`（3.x 系最高 2k） |
| `images` | | [File Array] 参考图，最多 10 张，仅限 4.0+ 模型 |

### 图片模型能力矩阵

| model | 最高分辨率 | 图生图 | 备注 |
|-------|-----------|--------|------|
| 5.0 | 4k | ✅ 最多 10 张 | 旗舰推荐 |
| 4.6 | 4k | ✅ 最多 10 张 | 高质量 |
| 4.5 | 4k | ✅ 最多 10 张 | |
| 4.1 | 4k | ✅ 最多 10 张 | |
| 4.0 | 4k | ✅ 最多 10 张 | |
| 3.1 | 2k | ❌ | 旧版 |
| 3.0 | 2k | ❌ | 旧版基础 |

### cURL 示例

```bash
# 文生图
curl -X POST http://SERVER:3000/v1/images/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=5.0" \
  -F "prompt=一只超写实机械猫咪" \
  -F "ratio=16:9" \
  -F "resolution_type=4k"

# 图生图（4.0+ 限定）
curl -X POST http://SERVER:3000/v1/images/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=5.0" \
  -F "prompt=改成水彩风格" \
  -F "images=@/path/to/ref.jpg"
```

---

## 接口2：视频创作

```
POST /v1/videos/generations
```

### 路由原则（API 端自动处理，客户端无需关心）

**3.x 系模型（3.0 / 3.0fast / 3.0pro / 3.5pro）：**
- 无附件 → 纯文生视频
- 仅传首帧图 → 单帧生视频（image2video）
- 首帧 + 尾帧图 → 首尾帧生视频（frames2video，仅 3.5pro / 3.0 支持双帧）

**seedance2.0 系模型：**
- 无附件 → 纯文生视频
- 加图片（1 张）→ 单图生视频
- 加图片（2+ 张）→ 多图叙事生视频（multiframe2video）
- 含视频或音频附件 → 多模态生视频（multimodal2video）

### 视频模型能力矩阵

| model | 时长 (s) | 最高分辨率 | 文生视频 | 首尾帧 | 多模态·音频 | 备注 |
|-------|----------|-----------|---------|--------|------------|------|
| seedance2.0_vip | 4–15 | 720p | ✅ | ✅ | ✅ 图+视+音 | VIP 超极速 |
| seedance2.0fast_vip | 4–15 | 720p | ✅ | ✅ | ✅ 图+视+音 | VIP 极速版 |
| seedance2.0 | 4–15 | 720p | ✅ | ✅ | ✅ 图+视+音 | 标准推荐 |
| seedance2.0fast | 4–15 | 720p | ✅ | ✅ | ✅ 图+视+音 | 快速出片 |
| 3.5pro | 4–12 | 1080p | ✅ | ✅ 首·尾帧 | ❌ | 精细高清 |
| 3.0pro | 3–10 | 1080p | ✅ | ✅ 首帧 | ❌ | 高清·单帧 |
| 3.0fast | 3–10 | 720p | ✅ | ✅ 首帧 | ❌ | 快速 |
| 3.0 | 3–10 | 720p/1080p | ✅ | ✅ 首·尾帧 | ❌ | 均衡 |

> 模型名称支持下划线别名：`3.0_fast` → `3.0fast`，`3.0_pro` → `3.0pro`，`3.5_pro` → `3.5pro`

### Form-Data 通用参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `prompt` | ✅ | 核心描述提示词 |
| `model` | | 模型名称，默认 `seedance2.0fast` |
| `duration` | | 时长（整数秒），范围见上表 |
| `video_resolution` | | seedance2.0 系：`720p`（暂仅此项，后续 1080p 支持时直接传入）<br>3.5pro / 3.0：`720p` 或 `1080p`；3.0pro：`1080p`；不传 = 模型默认 |
| `ratio` | | 画幅比 `16:9`、`9:16`、`1:1`、`3:4`、`4:3`、`21:9` 等。<br>**仅 text2video 和 multimodal2video 生效**；image2video / frames2video / multiframe2video 命令不传此参数，CLI 自动跟首帧比例 |

### 3.x 系 — 关键帧文件槽

| 字段名 | 说明 |
|--------|------|
| `image`（第 1 个） | 首帧图片，决定起始画面 |
| `image`（第 2 个） | 尾帧图片，决定结束画面（仅 3.5pro / 3.0 支持） |

### seedance2.0 系 — 多模态文件槽

| 字段名 | 数量 | 规格 | 说明 |
|--------|------|------|------|
| `image` | 最多 9 张 | jpg/png/webp，≤30MB，300–6000px | 参考图 |
| `video` | 最多 3 个 | mp4/mov，≤50MB，2–15 秒 | 参考视频 |
| `audio` | 最多 3 首 | wav/mp3，≤15MB，2–15 秒 | 参考音频 |

含 video 或 audio 时自动升级为多模态生视频。

### cURL 示例

```bash
# ① 纯文生视频
curl -X POST http://SERVER:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=seedance2.0" \
  -F "prompt=赛博朋克都市夜景" \
  -F "duration=5" -F "ratio=16:9"

# ② 单帧生视频（3.x 系）
curl -X POST http://SERVER:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=3.5pro" \
  -F "prompt=镜头慢慢拉远" \
  -F "image=@first.jpg"

# ③ 首尾帧生视频（3.5pro / 3.0）
curl -X POST http://SERVER:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=3.5pro" \
  -F "prompt=从晨到暮的街道变化" \
  -F "image=@morning.jpg" \
  -F "image=@evening.jpg"

# ④ 多模态生视频（seedance2.0 系）
curl -X POST http://SERVER:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=seedance2.0_vip" \
  -F "prompt=她跟随音乐的节拍起舞" \
  -F "image=@character.jpg" \
  -F "audio=@bgm.mp3"
```

---

## 任务查询

```
GET /v1/tasks/:id
Authorization: Bearer sk-jm-xxx
```

轮询建议间隔：**图片 5s，视频 15s**。视频最长生成时间因模型和火山排队情况而异，通常 1–5 分钟，请勿设置过短的超时放弃。

状态为 `success` 时从 `data[0].url` 取结果 URL。

### 推荐轮询逻辑（伪代码）

```javascript
async function pollTask(taskId, apiKey) {
  while (true) {
    const res = await fetch(`/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const data = await res.json();

    if (data.status === 'success') return data.data[0].url;
    if (data.status === 'failed')  throw new Error(data.error);

    // poll_warning = 我方网络抖动，任务没失败，继续等待即可
    if (data.poll_warning) console.warn('网络延迟:', data.poll_warning);

    await sleep(15000); // 视频建议 15s，图片可用 5s
  }
}
