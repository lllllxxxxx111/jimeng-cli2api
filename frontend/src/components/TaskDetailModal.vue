<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  task: any;
  token: string;
  liveStatus: any;
  liveLoading: boolean;
  liveError: string;
  failingId: string | null;
  failReason: string;
}>();

const emit = defineEmits<{
  close: [];
  refreshLive: [];
  stopTracking: [id: string];
  'update:failReason': [value: string];
}>();

const failReasonModel = computed({
  get: () => props.failReason,
  set: (value: string) => emit('update:failReason', value),
});

const statusLabel = (status: string) => ({
  PENDING: '待处理',
  PROCESSING: '生成中',
  SUCCESS: '已完成',
  FAILED: '已失败',
}[status] || status);

const statusClass = (status: string) => ({
  PENDING: 'bg-slate-100 text-slate-500',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-600',
}[status] || 'bg-slate-100 text-slate-500');

const previewUrl = () => {
  if (!props.task?.id || !props.token) return '';
  return `/admin/tasks/${encodeURIComponent(props.task.id)}/content?token=${encodeURIComponent(props.token)}`;
};

const mediaKind = () => {
  const text = `${props.task?.type || ''} ${props.task?.model || ''} ${props.task?.resultUrl || ''}`.toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/.test(text) || text.includes('video')) return 'video';
  if (/\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/.test(text) || text.includes('image') || text.includes('upscale')) return 'image';
  return 'file';
};
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-0 sm:p-4" @click.self="emit('close')">
    <div class="bg-white sm:rounded-2xl shadow-2xl w-full max-w-6xl h-[100dvh] sm:h-[92vh] flex flex-col">
      <div class="px-4 sm:px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 class="font-black text-slate-800 text-lg">任务详情</h3>
          <p class="text-xs text-slate-400 mt-1">本地状态、官方队列状态和结果预览分开显示</p>
        </div>
        <button @click="emit('close')" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-0 overflow-hidden flex-1">
        <div class="px-4 sm:px-6 py-5 overflow-y-auto space-y-4 text-sm">
          <div v-if="task.resultUrl" class="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
            <div class="px-4 py-3 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-sm font-black text-slate-800">结果预览</p>
                <p class="text-xs text-slate-400 mt-1">优先走本地代理；原始签名链接只作为排查备用。</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <a :href="previewUrl()" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg">打开预览</a>
                <a :href="task.resultUrl" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">原始链接</a>
              </div>
            </div>
            <img v-if="mediaKind() === 'image'" :src="previewUrl()" class="w-full max-h-[520px] object-contain bg-slate-950" loading="lazy" />
            <video v-else-if="mediaKind() === 'video'" :src="previewUrl()" controls class="w-full max-h-[520px] bg-slate-950"></video>
            <div v-else class="p-5 text-sm text-slate-600">该结果类型暂不内嵌预览，请打开预览链接查看。</div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">任务 ID</p><code class="text-xs font-mono text-slate-700 break-all select-all">{{ task.id }}</code></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">状态</p><span class="text-xs font-bold px-2 py-1 rounded-full" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">Submit ID</p><code class="text-xs font-mono text-slate-700 break-all select-all">{{ task.jimengSubmitId || '-' }}</code></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">Log ID</p><code class="text-xs font-mono text-slate-700 break-all select-all">{{ task.jimengLogId || '-' }}</code></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">类型</p><span class="font-mono text-xs">{{ task.type }}</span></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">模型</p><span class="font-mono text-xs">{{ task.model || '-' }}</span></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">账号</p><span>{{ task.account?.name || '-' }}</span></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">API Key 归属</p><span>{{ task.apiKey?.owner || '-' }}</span></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">创建时间</p><span>{{ new Date(task.createdAt).toLocaleString() }}</span></div>
            <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">更新时间</p><span>{{ new Date(task.updatedAt).toLocaleString() }}</span></div>
          </div>

          <div v-if="task.prompt"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Prompt</p><p class="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 break-words">{{ task.prompt }}</p></div>
          <div v-if="task.resultUrl"><p class="text-xs font-bold text-slate-400 uppercase mb-1">原始结果 URL</p><a :href="task.resultUrl" target="_blank" class="text-xs font-mono text-indigo-600 hover:underline break-all">{{ task.resultUrl }}</a></div>
          <div v-if="task.errorMsg"><p class="text-xs font-bold text-red-400 uppercase mb-1">失败原因</p><p class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 break-words">{{ task.errorMsg }}</p></div>
          <div v-if="task.pollErrorMsg"><p class="text-xs font-bold text-amber-500 uppercase mb-1">轮询异常（不代表任务失败）</p><p class="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 break-words font-mono">{{ task.pollErrorMsg }}</p></div>
        </div>

        <aside class="border-t xl:border-t-0 xl:border-l border-slate-100 bg-slate-50 px-4 sm:px-5 py-5 overflow-y-auto space-y-4">
          <div class="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-black text-slate-800">官方状态</p>
                <p class="text-xs text-slate-400 mt-1">从即梦 query_result 实时读取</p>
              </div>
              <button @click="emit('refreshLive')" :disabled="liveLoading || !task.jimengSubmitId" class="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 px-3 py-1.5 rounded-lg">{{ liveLoading ? '查询中' : '刷新' }}</button>
            </div>

            <p v-if="liveError" class="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{{ liveError }}</p>
            <div v-if="liveStatus" class="grid grid-cols-2 gap-3 text-xs">
              <div class="bg-slate-50 rounded-lg p-3"><p class="text-slate-400 font-bold">gen_status</p><p class="font-black text-slate-800 mt-1 break-words">{{ liveStatus.gen_status || '-' }}</p></div>
              <div class="bg-slate-50 rounded-lg p-3"><p class="text-slate-400 font-bold">queue_status</p><p class="font-black text-slate-800 mt-1 break-words">{{ liveStatus.queue_info?.queue_status || '-' }}</p></div>
              <div class="bg-slate-50 rounded-lg p-3"><p class="text-slate-400 font-bold">queue_idx</p><p class="font-black text-slate-800 mt-1">{{ liveStatus.queue_info?.queue_idx ?? '-' }}</p></div>
              <div class="bg-slate-50 rounded-lg p-3"><p class="text-slate-400 font-bold">queue_length</p><p class="font-black text-slate-800 mt-1">{{ liveStatus.queue_info?.queue_length ?? '-' }}</p></div>
              <div class="bg-slate-50 rounded-lg p-3"><p class="text-slate-400 font-bold">credit_count</p><p class="font-black text-slate-800 mt-1">{{ liveStatus.credit_count ?? '-' }}</p></div>
              <div class="bg-slate-50 rounded-lg p-3"><p class="text-slate-400 font-bold">刷新时间</p><p class="font-black text-slate-800 mt-1">{{ liveStatus.elapsedAt ? new Date(liveStatus.elapsedAt).toLocaleTimeString() : '-' }}</p></div>
            </div>
            <p v-else class="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-3">有 submit_id 的任务可以刷新官方状态和排队信息。</p>
          </div>

          <div v-if="task.status !== 'SUCCESS' && task.status !== 'FAILED'" class="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <p class="text-sm font-black text-slate-800">本地跟踪</p>
            <p class="text-xs text-slate-500 leading-5">停止跟踪只会更新本地任务状态，不会取消即梦侧生成。</p>
            <input v-model="failReasonModel" placeholder="停止原因（可选）" class="w-full border border-slate-300 px-3 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-red-400" />
            <button @click="emit('stopTracking', task.id)" :disabled="failingId === task.id" class="w-full text-xs font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-4 py-2.5 rounded-lg transition">停止本地跟踪</button>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
