<template>
  <div class="space-y-6">
    <section class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div class="p-6 lg:p-7 border-b border-slate-100 bg-slate-50">
        <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5">
          <div>
            <p class="text-xs font-bold text-indigo-600 uppercase tracking-wider">OpenAI Compatible API</p>
            <h2 class="text-2xl lg:text-3xl font-black text-slate-900 mt-2">即梦 CLI 接口文档</h2>
            <p class="text-sm text-slate-600 mt-3 leading-6 max-w-3xl">
              服务端负责登录即梦账号、账号轮询和任务执行；客户端只需要拿 API Key，按 OpenAI SDK 或 HTTP 协议提交生图、生视频、首尾帧、多模态和高清放大任务。
            </p>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div class="bg-white border border-slate-200 rounded-lg p-3">
              <p class="text-slate-400 font-bold">基础路径</p>
              <p class="font-mono font-black text-slate-800 mt-1">/v1</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-lg p-3">
              <p class="text-slate-400 font-bold">推荐模型</p>
              <p class="font-black text-slate-800 mt-1">16 个</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-lg p-3">
              <p class="text-slate-400 font-bold">功能能力</p>
              <p class="font-black text-slate-800 mt-1">9 类</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-lg p-3">
              <p class="text-slate-400 font-bold">调试模式</p>
              <p class="font-black text-slate-800 mt-1">dry-run</p>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
        <div class="p-5">
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">Base URL</p>
          <code class="block mt-2 bg-slate-950 text-emerald-300 rounded-lg px-4 py-3 text-xs font-mono overflow-x-auto">http://&lt;server&gt;:3000/v1</code>
        </div>
        <div class="p-5">
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">认证 Header</p>
          <code class="block mt-2 bg-slate-950 text-emerald-300 rounded-lg px-4 py-3 text-xs font-mono overflow-x-auto">Authorization: Bearer sk-jm-...</code>
        </div>
        <div class="p-5">
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">核心规则</p>
          <p class="mt-2 text-sm text-slate-700 leading-6">模型是模型，功能由 <code class="bg-slate-100 px-1 rounded font-mono">mode</code> 或 <code class="bg-slate-100 px-1 rounded font-mono">metadata.mode</code> 决定。</p>
        </div>
      </div>
    </section>

    <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-6">
      <div class="bg-white border border-slate-200 rounded-lg shadow-sm p-6 space-y-4">
        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h3 class="text-lg font-black text-slate-900">推荐调用方式</h3>
            <p class="text-sm text-slate-500 mt-1">后续接中转站或 OpenAI SDK，优先用这些入口。</p>
          </div>
          <span class="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1.5">新老接口并存</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-slate-50 text-slate-500">
                <th class="text-left px-4 py-3 border border-slate-100 font-bold">入口</th>
                <th class="text-left px-4 py-3 border border-slate-100 font-bold">适合场景</th>
                <th class="text-left px-4 py-3 border border-slate-100 font-bold">轮询</th>
              </tr>
            </thead>
            <tbody class="text-slate-700">
              <tr>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">GET /v1/models</td>
                <td class="px-4 py-3 border border-slate-100">获取推荐模型、能力和兼容旧模型</td>
                <td class="px-4 py-3 border border-slate-100">不需要</td>
              </tr>
              <tr class="bg-slate-50/60">
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">POST /v1/responses</td>
                <td class="px-4 py-3 border border-slate-100">OpenAI Responses 风格；生图、生视频、放大都可走 metadata</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">GET /v1/responses/:id</td>
              </tr>
              <tr>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">POST /v1/videos</td>
                <td class="px-4 py-3 border border-slate-100">OpenAI Videos 风格；主要用于视频 SDK 对接</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">GET /v1/videos/:id</td>
              </tr>
              <tr class="bg-slate-50/60">
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">POST /v1/images/generations</td>
                <td class="px-4 py-3 border border-slate-100">传统 form-data 生图、图生图</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">GET /v1/tasks/:id</td>
              </tr>
              <tr>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">POST /v1/videos/generations</td>
                <td class="px-4 py-3 border border-slate-100">传统 form-data 生视频，最贴近即梦 CLI 参数</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">GET /v1/tasks/:id</td>
              </tr>
              <tr class="bg-slate-50/60">
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">POST /v1/images/upscale</td>
                <td class="px-4 py-3 border border-slate-100">高清放大 2k / 4k / 8k</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">GET /v1/tasks/:id</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-slate-950 text-slate-200 rounded-lg shadow-sm p-5">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">最快连通性检查</p>
        <pre class="mt-3 text-xs font-mono overflow-x-auto leading-relaxed"><code>curl http://&lt;server&gt;:3000/v1/models \
  -H "Authorization: Bearer sk-jm-..."</code></pre>
        <div class="mt-5 border-t border-white/10 pt-5 space-y-3 text-sm text-slate-300 leading-6">
          <p>如果这个接口返回 401，说明 Key 错或已停用。</p>
          <p>如果返回模型列表，说明协议入口、鉴权和服务端都正常，再开始测试生成接口。</p>
        </div>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg shadow-sm p-6 space-y-5">
      <div>
        <h3 class="text-lg font-black text-slate-900">模型和功能怎么选</h3>
        <p class="text-sm text-slate-500 mt-1">推荐模型只保留主模型；功能通过参数选择，兼容旧 ID 仍可用但不建议新接入继续使用。</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="border border-slate-200 rounded-lg p-4">
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">图片模型</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <code v-for="model in imageModels" :key="model" class="bg-indigo-50 text-indigo-700 border border-indigo-100 rounded px-2 py-1 text-xs font-mono">{{ model }}</code>
          </div>
          <p class="text-xs text-slate-500 mt-3 leading-5">文生图默认走 <code class="bg-slate-100 px-1 rounded font-mono">text2image</code>；上传 images 时走 <code class="bg-slate-100 px-1 rounded font-mono">image2image</code>，仅 4.0 及以上支持图生图。</p>
        </div>
        <div class="border border-slate-200 rounded-lg p-4">
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">视频模型</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <code v-for="model in videoModels" :key="model" class="bg-sky-50 text-sky-700 border border-sky-100 rounded px-2 py-1 text-xs font-mono">{{ model }}</code>
          </div>
          <p class="text-xs text-slate-500 mt-3 leading-5">同一个视频模型可支持多个功能，用 <code class="bg-slate-100 px-1 rounded font-mono">mode</code> 明确选择。</p>
        </div>
        <div class="border border-slate-200 rounded-lg p-4">
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">放大模型</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <code class="bg-emerald-50 text-emerald-700 border border-emerald-100 rounded px-2 py-1 text-xs font-mono">jimeng-upscale</code>
          </div>
          <p class="text-xs text-slate-500 mt-3 leading-5">通过 <code class="bg-slate-100 px-1 rounded font-mono">resolution_type</code> 选择 2k、4k、8k。兼容别名 <code class="bg-slate-100 px-1 rounded font-mono">jimeng-upscale-4k</code> 仍可识别。</p>
        </div>
      </div>

      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 leading-6">
        <strong>重要：</strong>参数错误时服务端返回 400 和明确错误信息，不自动降级模型。这样可以避免你以为调用了高规格模型，实际后台偷偷换成另一个能力，后续统计和成本都会失真。
      </div>
    </section>

    <section class="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
      <div class="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h3 class="text-lg font-black text-slate-900">视频 mode 路由</h3>
        <p class="text-sm text-slate-500 mt-1 leading-6">多图最容易混淆，建议前端或中转站显式传 mode。</p>
        <div class="mt-4 space-y-3">
          <div v-for="item in modeRules" :key="item.mode" class="border border-slate-100 rounded-lg p-3">
            <div class="flex items-center justify-between gap-3">
              <code class="font-mono text-xs font-bold text-slate-800">{{ item.mode }}</code>
              <span class="text-[11px] font-bold text-slate-500 bg-slate-100 rounded px-2 py-0.5">{{ item.cli }}</span>
            </div>
            <p class="text-xs text-slate-500 mt-2 leading-5">{{ item.desc }}</p>
          </div>
        </div>
      </div>

      <div class="bg-white border border-slate-200 rounded-lg shadow-sm p-6 space-y-4">
        <h3 class="text-lg font-black text-slate-900">自动推断规则</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="bg-slate-50 text-slate-500">
                <th class="text-left px-4 py-3 border border-slate-100 font-bold">输入</th>
                <th class="text-left px-4 py-3 border border-slate-100 font-bold">auto 推断</th>
                <th class="text-left px-4 py-3 border border-slate-100 font-bold">建议</th>
              </tr>
            </thead>
            <tbody class="text-slate-700">
              <tr>
                <td class="px-4 py-3 border border-slate-100">只有 prompt</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">text2video</td>
                <td class="px-4 py-3 border border-slate-100">文生视频</td>
              </tr>
              <tr class="bg-slate-50/60">
                <td class="px-4 py-3 border border-slate-100">1 张图片</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">image2video</td>
                <td class="px-4 py-3 border border-slate-100">单图驱动视频</td>
              </tr>
              <tr>
                <td class="px-4 py-3 border border-slate-100">2 张图片</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">multimodal2video</td>
                <td class="px-4 py-3 border border-slate-100">如果是首尾帧，必须传 <code class="bg-slate-100 px-1 rounded font-mono">mode=frames2video</code></td>
              </tr>
              <tr class="bg-slate-50/60">
                <td class="px-4 py-3 border border-slate-100">图片 + 视频 / 音频</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">multimodal2video</td>
                <td class="px-4 py-3 border border-slate-100">适合 Seedance 多模态</td>
              </tr>
              <tr>
                <td class="px-4 py-3 border border-slate-100">3 张及以上图片</td>
                <td class="px-4 py-3 border border-slate-100 font-mono text-xs">multiframe2video</td>
                <td class="px-4 py-3 border border-slate-100">建议显式传 <code class="bg-slate-100 px-1 rounded font-mono">model=jimeng-video-keyframes</code> 或不传 model</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg shadow-sm p-6 space-y-5">
      <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h3 class="text-lg font-black text-slate-900">OpenAI SDK 示例</h3>
          <p class="text-sm text-slate-500 mt-1">示例使用 Node SDK。Python SDK 只需要保持 base_url/baseURL 和模型参数一致。</p>
        </div>
        <span class="text-xs font-bold text-slate-500 bg-slate-100 rounded-full px-3 py-1.5">推荐先加 dry-run 验证</span>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Responses 文生图</p>
          <pre class="bg-slate-950 text-indigo-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-jm-...",
  baseURL: "http://&lt;server&gt;:3000/v1",
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

const latest = await client.responses.retrieve(resp.id);</code></pre>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Responses 文生视频</p>
          <pre class="bg-slate-950 text-sky-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>const resp = await client.responses.create({
  model: "jimeng-video-seedance2.0fast",
  input: "城市夜景，镜头缓慢推进",
  metadata: {
    mode: "text2video",
    duration: 5,
    ratio: "16:9",
    video_resolution: "720p"
  }
});

const latest = await client.responses.retrieve(resp.id);</code></pre>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">OpenAI Videos 风格</p>
          <pre class="bg-slate-950 text-emerald-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>const video = await client.videos.create({
  model: "jimeng-video-seedance2.0fast",
  prompt: "城市夜景，镜头缓慢推进",
  seconds: 5,
  size: "1280x720",
  metadata: {
    mode: "text2video"
  }
});

const latest = await client.videos.retrieve(video.id);</code></pre>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Responses 高清放大</p>
          <pre class="bg-slate-950 text-amber-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>const resp = await client.responses.create({
  model: "jimeng-upscale",
  input: "放大这张图片",
  metadata: {
    operation: "image_upscale",
    image_urls: ["https://example.com/input.png"],
    resolution_type: "4k"
  }
});</code></pre>
        </div>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg shadow-sm p-6 space-y-5">
      <h3 class="text-lg font-black text-slate-900">dry-run：不消耗积分的路由测试</h3>
      <p class="text-sm text-slate-500 leading-6">
        加 <code class="bg-slate-100 px-1 rounded font-mono">X-Jimeng-Dry-Run: 1</code> 后，服务只做鉴权、参数校验、功能路由和命令构建，不提交 CLI、不占账号、不消耗积分。返回里的 <code class="bg-slate-100 px-1 rounded font-mono">command</code> 就是实际会执行的即梦 CLI 命令。
      </p>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <pre class="bg-slate-950 text-slate-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>curl -X POST http://&lt;server&gt;:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -H "X-Jimeng-Dry-Run: 1" \
  -F "model=jimeng-video-seedance2.0fast" \
  -F "mode=frames2video" \
  -F "prompt=从白天过渡到夜晚" \
  -F "image=@first.jpg" \
  -F "image=@last.jpg" \
  -F "duration=5"</code></pre>
        <pre class="bg-slate-950 text-slate-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>{
  "status": "completed",
  "dry_run": true,
  "task_type": "frames2video",
  "model": "jimeng-video-seedance2.0fast",
  "command": "dreamina frames2video ..."
}</code></pre>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg shadow-sm p-6 space-y-5">
      <h3 class="text-lg font-black text-slate-900">常用 form-data 示例</h3>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">文生图 / 图生图</p>
          <pre class="bg-slate-950 text-indigo-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>curl -X POST http://&lt;server&gt;:3000/v1/images/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-image-5.0" \
  -F "prompt=一张电影感机械猫肖像" \
  -F "ratio=16:9" \
  -F "resolution_type=2k"

# 图生图追加，可上传多张
# -F "images=@reference.jpg"</code></pre>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">多模态视频</p>
          <pre class="bg-slate-950 text-sky-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>curl -X POST http://&lt;server&gt;:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-video-seedance2.0fast" \
  -F "mode=multimodal2video" \
  -F "prompt=人物跟随音频自然说话" \
  -F "image=@face.jpg" \
  -F "audio=@voice.mp3" \
  -F "duration=8" \
  -F "ratio=16:9"</code></pre>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">多关键帧视频</p>
          <pre class="bg-slate-950 text-emerald-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>curl -X POST http://&lt;server&gt;:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-video-keyframes" \
  -F "mode=multiframe2video" \
  -F "image=@a.jpg" \
  -F "image=@b.jpg" \
  -F "image=@c.jpg" \
  -F "transition_prompt=镜头推进" \
  -F "transition_prompt=切到夜景" \
  -F "transition_duration=3" \
  -F "transition_duration=3"</code></pre>
        </div>
        <div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">图片放大</p>
          <pre class="bg-slate-950 text-amber-200 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>curl -X POST http://&lt;server&gt;:3000/v1/images/upscale \
  -H "Authorization: Bearer sk-jm-..." \
  -F "model=jimeng-upscale" \
  -F "image=@input.jpg" \
  -F "resolution_type=4k"</code></pre>
        </div>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
      <h3 class="text-lg font-black text-slate-900">返回和错误</h3>
      <div class="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
        <div class="border border-slate-200 rounded-lg p-4">
          <p class="font-bold text-slate-800">提交成功</p>
          <p class="text-slate-500 mt-2 leading-6">返回任务 ID，状态通常是 <code class="bg-slate-100 px-1 rounded font-mono">processing</code>、<code class="bg-slate-100 px-1 rounded font-mono">queued</code> 或 <code class="bg-slate-100 px-1 rounded font-mono">in_progress</code>。</p>
        </div>
        <div class="border border-slate-200 rounded-lg p-4">
          <p class="font-bold text-slate-800">轮询成功</p>
          <p class="text-slate-500 mt-2 leading-6">传统任务返回 <code class="bg-slate-100 px-1 rounded font-mono">data[0].url</code>；Responses / Videos 返回 <code class="bg-slate-100 px-1 rounded font-mono">metadata.result_url</code> 或 <code class="bg-slate-100 px-1 rounded font-mono">result_url</code>。</p>
        </div>
        <div class="border border-slate-200 rounded-lg p-4">
          <p class="font-bold text-slate-800">参数错误</p>
          <p class="text-slate-500 mt-2 leading-6">返回 <code class="bg-slate-100 px-1 rounded font-mono">error.message</code>，例如 duration 超范围、mode 与图片数量不匹配、模型不支持该功能。</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const imageModels = [
  'jimeng-image-3.0',
  'jimeng-image-3.1',
  'jimeng-image-4.0',
  'jimeng-image-4.1',
  'jimeng-image-4.5',
  'jimeng-image-4.6',
  'jimeng-image-5.0',
];

const videoModels = [
  'jimeng-video-3.0',
  'jimeng-video-3.0fast',
  'jimeng-video-3.0pro',
  'jimeng-video-3.5pro',
  'jimeng-video-seedance2.0',
  'jimeng-video-seedance2.0fast',
  'jimeng-video-seedance2.0_vip',
  'jimeng-video-seedance2.0fast_vip',
];

const modeRules = [
  { mode: 'text2video', cli: 'dreamina text2video', desc: '纯文字生成视频，不接受图片、视频或音频引用。' },
  { mode: 'image2video', cli: 'dreamina image2video', desc: '恰好 1 张图片生成视频，不接受音频或视频引用。' },
  { mode: 'frames2video', cli: 'dreamina frames2video', desc: '恰好 2 张图片作为首帧和尾帧。两图首尾帧一定要显式传这个 mode。' },
  { mode: 'multimodal2video', cli: 'dreamina multimodal2video', desc: '图片、视频、音频引用组合，适合 Seedance 2.0 系列。' },
  { mode: 'multiframe2video', cli: 'dreamina multiframe2video', desc: '2 到 20 张关键帧，不支持 model_version、ratio、video_resolution。' },
];
</script>
