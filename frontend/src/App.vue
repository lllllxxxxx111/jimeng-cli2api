<script setup lang="ts">
import { ref, onMounted } from 'vue';
import ApiDocs from './components/ApiDocs.vue';
import TaskDetailModal from './components/TaskDetailModal.vue';

const token = ref(localStorage.getItem('admin_token') || '');
const loginPassword = ref('');
const loginError = ref('');

const oldPassword = ref('');
const newPassword = ref('');
const pwdMessage = ref('');
const pwdError = ref('');

const accounts = ref<any[]>([]);
const apikeys = ref<any[]>([]);
const stats = ref<any | null>(null);
const statsLoading = ref(false);
const statsError = ref('');
const loading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const oauthModal = ref<{show:boolean;accountId:string;accountName:string;verificationUri:string;userCode:string;deviceCode:string;expiresAt:string;isNewAccount:boolean}>({ show:false, accountId:'', accountName:'', verificationUri:'', userCode:'', deviceCode:'', expiresAt:'', isNewAccount:false });
const createAccountModal = ref<{ show: boolean; name: string; error: string }>({ show: false, name: '', error: '' });
const checkLoginLoading = ref(false);
const userCodeCopied = ref(false);
const verificationUriCopied = ref(false);
const apiKeyResult = ref('');
const apiKeyOwner = ref('');
const apiKeyQuota = ref<number | null>(null);
const apiKeyBoundAccountId = ref<string>('');
const showAccountDropdown = ref(false);
const revealedKeyIds = ref<Set<string>>(new Set());
const rebindModal = ref<{ show: boolean; keyId: string; keyOwner: string; currentBoundId: string }>({ show: false, keyId: '', keyOwner: '', currentBoundId: '' });
const rebindNewAccountId = ref<string>('');
const checkingId = ref<string | null>(null);
const reloginLoadingId = ref<string | null>(null);

// ── 任务管理 ──
const tasks = ref<any[]>([]);
const taskTotal = ref(0);
const taskPage = ref(1);
const taskLimit = 20;
const taskFilterStatus = ref('');
const taskFilterPrompt = ref('');
const taskFilterError = ref('');
const taskFilterAccountId = ref('');
const taskLoading = ref(false);
const taskDetail = ref<any>(null);
const taskLiveStatus = ref<any>(null);
const taskLiveLoading = ref(false);
const taskLiveError = ref('');
const failReason = ref('');
const failingId = ref<string | null>(null);
const retryingId = ref<string | null>(null);
const riskPrompt = ref('');
const riskModel = ref('');
const riskType = ref('');
const riskLoading = ref(false);
const riskResult = ref<any>(null);
const riskError = ref('');
const riskShowAllMatches = ref(false);
const riskShowAllReasons = ref(false);
const nativeAccountId = ref('');
const nativeLoading = ref('');
const nativeError = ref('');
const nativeSessionsResult = ref<any>(null);
const nativeTasksResult = ref<any>(null);
const nativeQueryResult = ref<any>(null);
const nativeSessionMaxCount = ref(30);
const nativeSessionName = ref('');
const nativeSessionSearchName = ref('');
const nativeSessionId = ref('');
const nativeSessionNewName = ref('');
const nativeTaskStatus = ref('');
const nativeTaskType = ref('');
const nativeTaskSubmitId = ref('');
const nativeTaskLimit = ref(20);
const nativeTaskOffset = ref(0);
const nativeQuerySubmitId = ref('');
const nativeQueryDownload = ref(false);
const nativeQueryDownloadDirName = ref('');
const nativeShowAdvancedSessions = ref(false);
const nativeShowTaskRaw = ref(false);
const nativeShowQueryRaw = ref(false);
const nativeShowSessionRaw = ref(false);
const sdkApiKey = ref(localStorage.getItem('sdk_test_api_key') || '');
const sdkSelectedKeyId = ref('');
const sdkMode = ref('models');
const sdkPrompt = ref('一只赛博朋克机械猫，电影感灯光，细节丰富');
const sdkImageModel = ref('jimeng-image-5.0');
const sdkVideoModel = ref('jimeng-video-seedance2.0fast');
const sdkVideoMode = ref('auto');
const sdkRatio = ref('16:9');
const sdkResolution = ref('2k');
const sdkVideoSize = ref('1280x720');
const sdkVideoSeconds = ref(5);
const sdkVideoResolution = ref('720p');
const sdkSession = ref('');
const sdkMetadataJson = ref('');
const sdkResponse = ref<any>(null);
const sdkPollResponse = ref<any>(null);
const sdkLoading = ref(false);
const sdkPolling = ref(false);
const sdkError = ref('');
const sdkShowRawResponse = ref(false);
const sdkShowRawPollResponse = ref(false);
const sdkShowRequestPreview = ref(false);
const sdkShowAdvancedParams = ref(false);
const sdkShowLegacyModes = ref(false);
const sdkSubmitProgress = ref<any>(null);
const sdkSubmitTraceId = ref('');
const sdkSubmitStartedAt = ref(0);
const sdkSubmitElapsedMs = ref(0);
let sdkSubmitProgressTimer: number | null = null;

const currentTab = ref('monitor');

const tabMeta: Record<string, { title: string; subtitle: string }> = {
  monitor: { title: '运行监控', subtitle: '账号池、任务吞吐、失败率和运行资源' },
  accounts: { title: '账号池', subtitle: '维护服务端即梦账号实例和授权状态' },
  apikeys: { title: 'API 令牌', subtitle: '签发客户端访问令牌并绑定调度账号' },
  tasks: { title: '任务管理', subtitle: '追踪生成任务、失败原因和轮询状态' },
  risk: { title: '失败预检', subtitle: '提交前比对历史失败提示词' },
  native: { title: '原生工具', subtitle: '面向管理员的 CLI 会话、任务和结果查询' },
  docs: { title: '集成文档', subtitle: '查看 OpenAI SDK 兼容入口和即梦扩展参数' },
  sdkTest: { title: '接口测试', subtitle: '直接测试 OpenAI SDK 兼容接口和轮询结果' },
  settings: { title: '管理员安全', subtitle: '修改后台访问密码' },
};

const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token.value}`
});

const doLogin = async () => {
  try {
    const res = await fetch('/admin/sys/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginPassword.value })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      token.value = data.token;
      localStorage.setItem('admin_token', token.value);
      loginError.value = '';
      loginPassword.value = '';
      initData();
    } else {
      loginError.value = data.error || '登录失败';
    }
  } catch (err: any) {
    loginError.value = err.message;
  }
};

const doLogout = () => {
  token.value = '';
  localStorage.removeItem('admin_token');
};

const copyVerificationUri = async () => {
  const uri = oauthModal.value.verificationUri;
  try {
    await navigator.clipboard.writeText(uri);
  } catch {
    const el = document.createElement('textarea');
    el.value = uri;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
  verificationUriCopied.value = true;
  setTimeout(() => { verificationUriCopied.value = false; }, 2000);
};

const copyUserCode = async () => {
  const code = oauthModal.value.userCode;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const el = document.createElement('textarea');
    el.value = code;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
  userCodeCopied.value = true;
  setTimeout(() => { userCodeCopied.value = false; }, 2000);
};



const doUpdatePassword = async () => {
  try {
    const res = await fetch('/admin/sys/password', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ oldPassword: oldPassword.value, newPassword: newPassword.value })
    });
    const data = await res.json();
    if (res.ok) {
      pwdMessage.value = data.message;
      pwdError.value = '';
      oldPassword.value = '';
      newPassword.value = '';
      setTimeout(doLogout, 2000);
    } else {
      pwdError.value = data.error || '修改失败';
      pwdMessage.value = '';
    }
  } catch (err: any) {
    pwdError.value = err.message;
  }
};

const authFetch = async (url: string, options: any = {}) => {
  options.headers = { ...options.headers, ...headers() };
  const res = await fetch(url, options);
  if (res.status === 401 || res.status === 403) {
    doLogout();
    throw new Error("登录已过期，请重新登录");
  }
  return res;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatRate = (value: number) => `${((Number(value) || 0) * 100).toFixed(1)}%`;
const maxCount = (items: Array<{ count: number }> = []) => Math.max(1, ...items.map((item) => item.count || 0));
const barWidth = (count: number, max: number) => `${Math.max(4, Math.round((count / Math.max(max, 1)) * 100))}%`;
const shortText = (value: string, max = 90) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
};

const pageTitle = () => tabMeta[currentTab.value]?.title || '控制台';
const pageSubtitle = () => tabMeta[currentTab.value]?.subtitle || '';

const availableAccountCount = () => stats.value?.accounts?.idle ?? accounts.value.filter((item: any) => item.status === 'IDLE').length;
const processingTaskCount = () => stats.value?.tasks?.processing ?? tasks.value.filter((item: any) => item.status === 'PROCESSING').length;
const todaySuccessCount = () => stats.value?.tasks?.today?.success ?? 0;
const riskScorePercent = (value: number) => `${Math.round((Number(value) || 0) * 100)}%`;
const riskLevelClass = (level: string) => ({
  clear: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  low: 'text-sky-700 bg-sky-50 border-sky-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  high: 'text-red-700 bg-red-50 border-red-200',
}[level] || 'text-slate-700 bg-slate-50 border-slate-200');
const riskPanelAccentClass = (level: string) => ({
  clear: 'border-emerald-200',
  low: 'border-sky-200',
  medium: 'border-amber-200',
  high: 'border-red-200',
}[level] || 'border-slate-200');
const riskAccentClass = (level: string) => ({
  clear: 'bg-emerald-400',
  low: 'bg-sky-400',
  medium: 'bg-amber-400',
  high: 'bg-red-400',
}[level] || 'bg-slate-400');
const riskSimilarityLevel = (value: number) => {
  const score = Number(value) || 0;
  if (score >= 0.78) return 'high';
  if (score >= 0.48) return 'medium';
  if (score >= 0.28) return 'low';
  return 'clear';
};
const riskSimilarityClass = (value: number) => riskLevelClass(riskSimilarityLevel(value));
const riskSimilarityBarClass = (value: number) => riskAccentClass(riskSimilarityLevel(value));
const riskActionLabel = (level: string) => ({
  clear: '可以试跑',
  low: '谨慎提交',
  medium: '建议改写',
  high: '先不要提交',
}[level] || '待判断');

const mergeAccountMetrics = (account: any) => {
  const statsRow = stats.value?.accounts?.accounts?.find((item: any) => item.id === account.id);
  return account.metrics || statsRow || {
    totalCreatives: 0,
    todayCreatives: 0,
    processingTasks: 0,
    todaySuccess: 0,
    failedTasks: 0,
    todayFailed: 0,
  };
};

const accountStatusLabel = (status: string) => ({
  IDLE: '可用',
  BUSY: '忙碌',
  ERROR: '异常',
}[status] || status || '-');

const accountStatusClass = (status: string) => ({
  IDLE: 'bg-emerald-100 text-emerald-700',
  BUSY: 'bg-blue-100 text-blue-700',
  ERROR: 'bg-red-100 text-red-600',
}[status] || 'bg-slate-100 text-slate-500');

const accountDotClass = (status: string) => ({
  IDLE: 'bg-emerald-400',
  BUSY: 'bg-blue-400',
  ERROR: 'bg-red-400',
}[status] || 'bg-slate-300');

const operationHealth = () => {
  if (!stats.value) {
    return {
      label: '等待数据',
      detail: '运行数据尚未加载',
      className: 'bg-slate-100 text-slate-600',
      accentClass: 'bg-slate-400',
    };
  }
  if (stats.value.accounts.idle <= 0) {
    return {
      label: '账号不可用',
      detail: '当前没有可直接调度的账号',
      className: 'bg-red-100 text-red-700',
      accentClass: 'bg-red-400',
    };
  }
  if (stats.value.failures.todayRate >= 0.2 || stats.value.accounts.error > 0) {
    return {
      label: '需要处理',
      detail: '失败率或账号异常偏高',
      className: 'bg-amber-100 text-amber-700',
      accentClass: 'bg-amber-400',
    };
  }
  if (stats.value.tasks.processing || stats.value.tasks.pending) {
    return {
      label: '生产中',
      detail: '队列正在消化任务',
      className: 'bg-blue-100 text-blue-700',
      accentClass: 'bg-blue-400',
    };
  }
  return {
    label: '运行稳定',
    detail: '账号池和任务队列正常',
    className: 'bg-emerald-100 text-emerald-700',
    accentClass: 'bg-emerald-400',
  };
};

const getAccountMetrics = (accountId: string) => {
  const account = accounts.value.find((item: any) => item.id === accountId);
  if (account) return mergeAccountMetrics(account);
  const row = stats.value?.accounts?.accounts?.find((item: any) => item.id === accountId);
  return row || { totalCreatives: 0, todayCreatives: 0, processingTasks: 0, todaySuccess: 0, failedTasks: 0, todayFailed: 0 };
};

const navGroups = [
  {
    title: '总览',
    items: [
      { key: 'monitor', label: '运行监控', badge: () => processingTaskCount() },
      { key: 'tasks', label: '任务管理', badge: () => taskTotal || stats.value?.tasks?.total || 0 },
      { key: 'risk', label: '失败预检', badge: () => stats.value?.failures?.byPrompt?.length || 0 },
    ],
  },
  {
    title: '配置',
    items: [
      { key: 'accounts', label: '账号池', badge: () => accounts.value.length },
      { key: 'apikeys', label: 'API 令牌', badge: () => apikeys.value.length },
    ],
  },
  {
    title: '集成',
    items: [
      { key: 'sdkTest', label: '接口测试', badge: 'TRY' },
      { key: 'docs', label: '接口文档', badge: 'SDK' },
      { key: 'native', label: '原生工具', badge: 'CLI' },
    ],
  },
  {
    title: '系统',
    items: [
      { key: 'settings', label: '管理员安全', badge: '' },
    ],
  },
];

const navBadge = (item: any) => typeof item.badge === 'function' ? item.badge() : item.badge;
const navItemClass = (key: string) => currentTab.value === key
  ? 'bg-white text-slate-950 shadow-sm border-white'
  : 'text-slate-300 hover:bg-white/5 hover:text-white border-transparent';

const setTab = (tab: string) => {
  currentTab.value = tab;
  if (tab === 'monitor') fetchStats();
  if (tab === 'accounts') {
    fetchAccounts();
    fetchStats();
  }
  if (tab === 'apikeys') {
    fetchApiKeys();
    fetchStats();
  }
  if (tab === 'tasks') fetchTasks(1);
};

const openTaskList = (status = '') => {
  taskFilterStatus.value = status;
  taskFilterAccountId.value = '';
  taskFilterPrompt.value = '';
  taskFilterError.value = '';
  currentTab.value = 'tasks';
  fetchTasks(1);
};

const selectedNativeAccountName = () => accounts.value.find((item: any) => item.id === nativeAccountId.value)?.name || '';

const nativeResultText = (result: any) => {
  if (!result) return '';
  const parts = [];
  if (result.elapsedMs !== undefined) parts.push(`elapsed: ${result.elapsedMs}ms`);
  if (result.command) parts.push(`$ ${result.command}`);
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  if (result.parsed) parts.push(`parsed:\n${JSON.stringify(result.parsed, null, 2)}`);
  if (result.downloadDir) parts.push(`downloadDir: ${result.downloadDir}`);
  return parts.join('\n\n') || JSON.stringify(result, null, 2);
};

type NativeTaskItem = {
  submitId: string;
  status: string;
  taskType: string;
  createdAt: string;
  updatedAt: string;
  prompt: string;
  raw: any;
};

type NativeSessionItem = {
  id: string;
  name: string;
  updatedAt: string;
  status: string;
  raw: any;
};

const nativeParsedRoot = (result: any) => result?.parsed ?? result?.data ?? result?.result ?? result;

const nativeIsObject = (value: any) => value !== null && typeof value === 'object';

const nativeDisplayValue = (value: any) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const nativePick = (value: any, keys: string[]) => {
  if (!nativeIsObject(value) || Array.isArray(value)) return '';
  for (const key of keys) {
    const picked = nativeDisplayValue(value[key]);
    if (picked) return picked;
  }
  return '';
};

const nativePickDeep = (value: any, keys: string[], depth = 0): string => {
  if (!nativeIsObject(value) || depth > 6) return '';
  const direct = nativePick(value, keys);
  if (direct) return direct;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const picked = nativePickDeep(child, keys, depth + 1);
    if (picked) return picked;
  }
  return '';
};

const nativeFindArray = (value: any, isItem: (item: any) => boolean, depth = 0): any[] => {
  if (!nativeIsObject(value) || depth > 6) return [];
  if (Array.isArray(value)) {
    if (value.some(isItem)) return value.filter(nativeIsObject);
    for (const item of value) {
      const found = nativeFindArray(item, isItem, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  for (const child of Object.values(value)) {
    const found = nativeFindArray(child, isItem, depth + 1);
    if (found.length) return found;
  }
  return [];
};

const nativeTaskStatusLabel = (status: string) => {
  const value = String(status || '').toLowerCase();
  if (!value) return '-';
  if (['success', 'succeeded', 'done', 'completed', 'complete', 'finish', 'finished'].includes(value)) return '已完成';
  if (['failed', 'fail', 'error', 'canceled', 'cancelled'].includes(value)) return '失败';
  if (value.includes('queue') || value.includes('pending') || value.includes('wait')) return '排队中';
  if (value.includes('process') || value.includes('running') || value.includes('generat')) return '生成中';
  return status;
};

const nativeTaskStatusClass = (status: string) => {
  const value = String(status || '').toLowerCase();
  if (value.includes('success') || value.includes('done') || value.includes('complete') || value.includes('finish')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (value.includes('fail') || value.includes('error') || value.includes('cancel')) return 'bg-red-50 text-red-700 border-red-100';
  if (value.includes('queue') || value.includes('pending') || value.includes('wait')) return 'bg-amber-50 text-amber-700 border-amber-100';
  if (value.includes('process') || value.includes('running') || value.includes('generat')) return 'bg-blue-50 text-blue-700 border-blue-100';
  return 'bg-slate-50 text-slate-600 border-slate-100';
};

const isNativeTaskLike = (item: any) => nativeIsObject(item) && [
  'submit_id',
  'submitId',
  'task_id',
  'taskId',
  'gen_status',
  'gen_task_type',
  'task_type',
].some(key => Object.prototype.hasOwnProperty.call(item, key));

const nativeTaskItems = (result: any): NativeTaskItem[] => {
  const root = nativeParsedRoot(result);
  const source = nativeFindArray(root, isNativeTaskLike);
  const items = source.length ? source : (isNativeTaskLike(root) ? [root] : []);
  return items.map((item: any) => ({
    submitId: nativePickDeep(item, ['submit_id', 'submitId', 'task_id', 'taskId', 'id']),
    status: nativePickDeep(item, ['gen_status', 'task_status', 'status', 'state']),
    taskType: nativePickDeep(item, ['gen_task_type', 'task_type', 'taskType', 'type', 'operation']),
    createdAt: nativePickDeep(item, ['create_time', 'created_at', 'createdAt', 'submit_time', 'start_time']),
    updatedAt: nativePickDeep(item, ['update_time', 'updated_at', 'updatedAt', 'finish_time', 'complete_time']),
    prompt: nativePickDeep(item, ['prompt', 'input', 'text', 'query', 'description']),
    raw: item,
  })).filter((item: NativeTaskItem) => item.submitId || item.status || item.taskType);
};

const isNativeSessionLike = (item: any) => nativeIsObject(item) && [
  'session_id',
  'sessionId',
  'id',
  'session_name',
  'sessionName',
  'name',
].some(key => Object.prototype.hasOwnProperty.call(item, key));

const nativeSessionItems = (result: any): NativeSessionItem[] => {
  const root = nativeParsedRoot(result);
  const source = nativeFindArray(root, isNativeSessionLike);
  const items = source.length ? source : (isNativeSessionLike(root) ? [root] : []);
  return items.map((item: any) => ({
    id: nativePickDeep(item, ['session_id', 'sessionId', 'id']),
    name: nativePickDeep(item, ['session_name', 'sessionName', 'name', 'title']),
    updatedAt: nativePickDeep(item, ['updated_at', 'updatedAt', 'update_time', 'create_time', 'created_at']),
    status: nativePickDeep(item, ['status', 'state']),
    raw: item,
  })).filter((item: NativeSessionItem) => item.id || item.name);
};

const useNativeSubmitId = (submitId: string) => {
  if (!submitId) return;
  nativeQuerySubmitId.value = submitId;
  nativeError.value = '';
  successMessage.value = '已填入结果查询';
};

const queryNativeSubmitId = async (submitId: string) => {
  useNativeSubmitId(submitId);
  if (submitId) await queryNativeResult();
};

const useNativeSession = (session: NativeSessionItem) => {
  if (!session.id) return;
  nativeSessionId.value = session.id;
  if (session.name) {
    nativeSessionNewName.value = session.name;
    nativeSessionSearchName.value = session.name;
  }
  successMessage.value = '已填入会话 ID';
};

const nativeQuickTaskTypeOptions = [
  { value: '', label: '全部类型' },
  { value: 'text2image', label: '文生图' },
  { value: 'image2image', label: '图生图' },
  { value: 'image_upscale', label: '图片放大' },
  { value: 'text2video', label: '文生视频' },
  { value: 'image2video', label: '图生视频' },
  { value: 'frames2video', label: '首尾帧视频' },
  { value: 'multiframe2video', label: '多帧视频' },
  { value: 'multimodal2video', label: '多模态视频' },
];

const nativeQuickStatusOptions = [
  { value: '', label: '全部状态' },
  { value: 'processing', label: '生成中' },
  { value: 'success', label: '已完成' },
  { value: 'failed', label: '失败' },
];

const nativeCollectUrls = (result: any) => {
  const urls = new Set<string>();
  const addFromText = (text: string) => {
    const matches = text.match(/https?:\/\/[^\s"'<>)\\]+/g) || [];
    matches.forEach(url => urls.add(url));
  };
  const visit = (value: any, depth = 0) => {
    if (depth > 8 || value === undefined || value === null) return;
    if (typeof value === 'string') {
      addFromText(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach(item => visit(item, depth + 1));
    }
  };
  addFromText(nativeResultText(result));
  visit(nativeParsedRoot(result));
  return Array.from(urls);
};

const nativeResultSummary = (result: any) => {
  if (!result) return null;
  const text = nativeResultText(result);
  const parsed = nativeParsedRoot(result) || {};
  const urls = nativeCollectUrls(result);
  return {
    urls,
    url: urls[0] || '',
    submitId: nativePickDeep(parsed, ['submit_id', 'submitId', 'task_id', 'taskId', 'id']) || nativePickDeep(result, ['submit_id', 'submitId', 'task_id', 'taskId']),
    status: nativePickDeep(parsed, ['gen_status', 'task_status', 'status', 'state']),
    taskType: nativePickDeep(parsed, ['gen_task_type', 'task_type', 'taskType', 'type', 'operation']),
    credit: nativePickDeep(parsed, ['credit_count', 'creditCount', 'credit', 'cost']),
    queue: nativePickDeep(parsed, ['queue_info', 'queueInfo', 'queue', 'queue_position', 'position', 'wait_time']),
    downloadDir: nativePickDeep(result, ['downloadDir']) || nativePickDeep(parsed, ['download_dir', 'downloadDir']),
    localPath: nativePickDeep(parsed, ['local_path', 'localPath', 'file_path', 'download_path', 'path']),
    raw: text,
  };
};

const jsonText = (value: any) => value ? JSON.stringify(value, null, 2) : '';

const selectedSdkKey = () => apikeys.value.find((item: any) => item.id === sdkSelectedKeyId.value);

const activeSdkApiKey = () => {
  const pasted = sdkApiKey.value.trim();
  if (pasted) return pasted;
  return canUseSelectedSdkKey() ? selectedSdkKey()?.key || '' : '';
};

const canUseSelectedSdkKey = () => {
  const key = selectedSdkKey();
  return Boolean(key?.key && !String(key.key).includes('*'));
};

const saveSdkApiKey = () => {
  const key = sdkApiKey.value.trim();
  if (key) {
    localStorage.setItem('sdk_test_api_key', key);
    successMessage.value = '测试 API Key 已保存到本机浏览器';
  } else {
    localStorage.removeItem('sdk_test_api_key');
    successMessage.value = '已清空本机保存的测试 API Key';
  }
};

const useSelectedSdkKey = () => {
  const key = selectedSdkKey();
  if (!key) return;
  if (!canUseSelectedSdkKey()) {
    sdkError.value = '这个 Key 是脱敏显示，不能直接用于测试。请粘贴完整 Key，或新签发一个 Key 后立即复制。';
    return;
  }
  sdkApiKey.value = key.key;
  sdkError.value = '';
};

const sdkModeOptions = [
  { value: 'models', label: '模型列表', endpoint: 'GET /v1/models', cost: '不消耗额度', hint: '先用它验证 Key 和服务可用性。', legacy: false },
  { value: 'responses-image', label: 'Responses 文生图', endpoint: 'POST /v1/responses', cost: '会创建真实任务', hint: 'OpenAI SDK 推荐入口，返回 resp_*。', legacy: false },
  { value: 'responses-video', label: 'Responses 生视频', endpoint: 'POST /v1/responses', cost: '会创建真实任务', hint: '用 metadata 指定视频模式和清晰度。', legacy: false },
  { value: 'videos-create', label: 'Videos SDK', endpoint: 'POST /v1/videos', cost: '会创建真实任务', hint: '兼容 OpenAI videos.create / retrieve。', legacy: false },
  { value: 'legacy-image', label: '老接口生图', endpoint: 'POST /v1/images/generations', cost: '会创建真实任务', hint: '保留给旧客户端或表单请求。', legacy: true },
  { value: 'legacy-video', label: '老接口生视频', endpoint: 'POST /v1/videos/generations', cost: '会创建真实任务', hint: '旧版视频表单入口。', legacy: true },
];

const primarySdkModeOptions = () => sdkModeOptions.filter(item => !item.legacy);

const legacySdkModeOptions = () => sdkModeOptions.filter(item => item.legacy);

const sdkModeConfig = () => sdkModeOptions.find(item => item.value === sdkMode.value) || sdkModeOptions[0];

const sdkModeLabel = () => sdkModeConfig().label;

const sdkNextActionLabel = () => {
  if (!activeSdkApiKey()) return '先配置完整 API Key';
  if (sdkLoading.value) return '正在发送请求';
  if (sdkPolling.value) return '正在轮询结果';
  if (!sdkResponse.value) return '发送测试请求';
  if (pollPathForSdkResponse(sdkResponse.value) && !sdkPollResponse.value) return '轮询结果';
  if (sdkTaskPreviewUrl(sdkPollResponse.value || sdkResponse.value)) return '打开预览或去任务页';
  return '查看摘要或展开 JSON';
};

const parseSdkMetadata = () => {
  if (!sdkMetadataJson.value.trim()) return {};
  try {
    return JSON.parse(sdkMetadataJson.value);
  } catch (error: any) {
    throw new Error('扩展 metadata 不是合法 JSON: ' + error.message);
  }
};

const parseSdkSession = () => {
  if (sdkSession.value === '') return undefined;
  const session = Number(sdkSession.value);
  if (!Number.isInteger(session) || session < 0) {
    throw new Error('CLI session 必须是大于等于 0 的整数');
  }
  return session;
};

const sdkModelOptions = {
  image: ['3.0', '3.1', '4.0', '4.1', '4.5', '4.6', '5.0'].map(model => ({
    value: `jimeng-image-${model}`,
    label: `jimeng-image-${model}`,
  })),
  video: ['3.0', '3.0fast', '3.0pro', '3.5pro', 'seedance2.0', 'seedance2.0fast', 'seedance2.0_vip', 'seedance2.0fast_vip'].map(model => ({
    value: `jimeng-video-${model}`,
    label: `jimeng-video-${model}`,
  })),
};

const sdkVideoModeOptions = [
  { value: 'auto', label: '自动判断' },
  { value: 'text2video', label: '文字生成视频' },
  { value: 'image2video', label: '单图生成视频' },
  { value: 'frames2video', label: '首尾帧视频' },
  { value: 'multimodal2video', label: '多图/多模态视频' },
  { value: 'multiframe2video', label: '多关键帧视频' },
];

const sdkImageModelVersion = () => String(sdkImageModel.value || '').replace(/^jimeng-image-/, '');

const sdkVideoModelVersion = () => String(sdkVideoModel.value || '').replace(/^jimeng-video-/, '');

const sdkImageResolutionOptions = () => {
  const version = sdkImageModelVersion();
  const values = version === '3.0' || version === '3.1' ? ['1k', '2k'] : ['2k', '4k'];
  return values.map(value => ({ value, label: value }));
};

const sdkResolvedVideoMode = () => sdkVideoMode.value === 'auto' ? 'text2video' : sdkVideoMode.value;

const sdkVideoResolutionOptions = () => {
  const mode = sdkResolvedVideoMode();
  if (mode === 'multiframe2video') return [{ value: '', label: '不支持' }];
  const values = sdkVideoModelVersion() === 'seedance2.0_vip' ? ['720p', '1080p'] : ['720p'];
  return [{ value: '', label: '默认' }, ...values.map(value => ({ value, label: value }))];
};

const sdkVideoDurationRange = () => {
  const mode = sdkResolvedVideoMode();
  const model = sdkVideoModelVersion();
  if (mode === 'text2video' || mode === 'multimodal2video') return { min: 4, max: 15 };
  if (model === '3.5pro') return { min: 4, max: 12 };
  if (['3.0', '3.0fast', '3.0pro'].includes(model)) return { min: 3, max: 10 };
  return { min: 4, max: 15 };
};

const syncSdkImageResolution = () => {
  const allowed = sdkImageResolutionOptions().map(item => item.value);
  if (!allowed.includes(sdkResolution.value)) sdkResolution.value = allowed[0] || '2k';
};

const syncSdkVideoOptions = () => {
  const allowedResolutions = sdkVideoResolutionOptions().map(item => item.value);
  if (!allowedResolutions.includes(sdkVideoResolution.value)) sdkVideoResolution.value = allowedResolutions[0] || '';
  const range = sdkVideoDurationRange();
  const seconds = Number(sdkVideoSeconds.value) || range.min;
  sdkVideoSeconds.value = Math.min(range.max, Math.max(range.min, seconds));
};

const selectSdkMode = (mode: string) => {
  sdkMode.value = mode;
  syncSdkImageResolution();
  syncSdkVideoOptions();
};

const preferredSdkModels = (models: any[]) => models.filter((item: any) => String(item.id || '').startsWith('jimeng-'));

const legacySdkModels = (models: any[]) => models.filter((item: any) => !String(item.id || '').startsWith('jimeng-'));

const sdkEndpoint = () => {
  if (sdkMode.value === 'models') return { method: 'GET', path: '/v1/models', contentType: 'json' };
  if (sdkMode.value === 'responses-image' || sdkMode.value === 'responses-video') return { method: 'POST', path: '/v1/responses', contentType: 'json' };
  if (sdkMode.value === 'videos-create') return { method: 'POST', path: '/v1/videos', contentType: 'json' };
  if (sdkMode.value === 'legacy-image') return { method: 'POST', path: '/v1/images/generations', contentType: 'form' };
  return { method: 'POST', path: '/v1/videos/generations', contentType: 'form' };
};

const buildSdkPayload = () => {
  if (sdkMode.value === 'models') return null;
  const extra = parseSdkMetadata();
  const session = parseSdkSession();

  if (sdkMode.value === 'responses-image') {
    return {
      model: sdkImageModel.value,
      input: sdkPrompt.value,
      tools: [{ type: 'image_generation' }],
      metadata: {
        ratio: sdkRatio.value,
        resolution_type: sdkResolution.value || undefined,
        session,
        ...extra,
      },
    };
  }

  if (sdkMode.value === 'responses-video') {
    return {
      model: sdkVideoModel.value,
      input: sdkPrompt.value,
      metadata: {
        mode: sdkVideoMode.value,
        duration: Number(sdkVideoSeconds.value) || 5,
        ratio: sdkRatio.value,
        video_resolution: sdkVideoResolution.value || undefined,
        session,
        ...extra,
      },
    };
  }

  if (sdkMode.value === 'videos-create') {
    return {
      model: sdkVideoModel.value,
      prompt: sdkPrompt.value,
      size: sdkVideoSize.value,
      seconds: Number(sdkVideoSeconds.value) || 5,
      metadata: {
        mode: sdkVideoMode.value,
        video_resolution: sdkVideoResolution.value || undefined,
        session,
        ...extra,
      },
    };
  }

  const body: Record<string, any> = sdkMode.value === 'legacy-image'
    ? {
        model: sdkImageModel.value,
        prompt: sdkPrompt.value,
        ratio: sdkRatio.value,
        resolution_type: sdkResolution.value,
        session,
        ...extra,
      }
    : {
        model: sdkVideoModel.value,
        prompt: sdkPrompt.value,
        mode: sdkVideoMode.value,
        duration: Number(sdkVideoSeconds.value) || 5,
        ratio: sdkRatio.value,
        video_resolution: sdkVideoResolution.value || undefined,
        session,
        ...extra,
      };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined && value !== ''));
};

const compactSdkValue = (value: any) => {
  const text = String(value ?? '-');
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
};

const sdkQueueSummary = (value: any) => {
  const queue = value?.queue || value?.metadata?.queue || {};
  const progress = value?.progress ?? queue.progress ?? value?.metadata?.progress;
  const parts = [
    queue.status ? `status: ${queue.status}` : '',
    queue.index !== undefined && queue.index !== null ? `index: ${queue.index}` : '',
    queue.length !== undefined && queue.length !== null ? `length: ${queue.length}` : '',
    queue.wait_seconds !== undefined && queue.wait_seconds !== null ? `wait: ${queue.wait_seconds}s` : '',
    queue.last_polled_at ? `last poll: ${new Date(queue.last_polled_at).toLocaleString()}` : '',
  ].filter(Boolean);
  const stats = [
    queue.status ? { label: 'Queue', value: compactSdkValue(queue.status) } : null,
    progress !== undefined && progress !== null ? { label: 'Progress', value: `${progress}%` } : null,
    queue.index !== undefined && queue.index !== null ? { label: 'Queue position', value: queue.length !== undefined && queue.length !== null ? `${queue.index}/${queue.length}` : queue.index } : null,
    queue.wait_seconds !== undefined && queue.wait_seconds !== null ? { label: 'Wait', value: `${queue.wait_seconds}s` } : null,
  ].filter(Boolean) as Array<{ label: string; value: any }>;
  return { queue, progress, parts, stats };
};

type SdkSummaryGroup = {
  label: string;
  items: string[];
};

type SdkMediaPreview = {
  url: string;
  kind: 'image' | 'video' | 'file';
  label: string;
};

const inferSdkMediaKind = (url: string, hint = ''): SdkMediaPreview['kind'] => {
  const lower = `${url} ${hint}`.toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/.test(lower) || lower.includes('video')) return 'video';
  if (/\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/.test(lower) || lower.includes('image') || lower.includes('upscale')) return 'image';
  return 'file';
};

const sdkMediaTypeHint = (value: any, fallback?: any) => {
  const taskType = String(value?.task_type || value?.metadata?.task_type || fallback?.task_type || fallback?.metadata?.task_type || '').toLowerCase();
  const objectType = String(value?.object || fallback?.object || '').toLowerCase();
  if (taskType.includes('video') || objectType === 'video') return 'video';
  if (taskType.includes('image') || taskType.includes('upscale')) return 'image';
  return '';
};

const sdkMediaPreview = (value: any, fallback?: any): SdkMediaPreview[] => {
  if (!value) return [];
  const previews: SdkMediaPreview[] = [];
  const seen = new Set<string>();
  const baseHint = sdkMediaTypeHint(value, fallback);
  const add = (url: string, hint: string, label: string) => {
    const clean = String(url || '').trim();
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    previews.push({ url: clean, kind: inferSdkMediaKind(clean, `${baseHint} ${hint}`), label });
  };
  const visit = (node: any, path: string[] = []) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      const keyPath = path.join('.').toLowerCase();
      if (/(url|result|href|content|image|video|data|output)/.test(keyPath) || /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v)(\?|#|$)/i.test(node)) {
        add(node, keyPath, path[path.length - 1] || 'url');
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (typeof node === 'object') {
      Object.entries(node).forEach(([key, item]) => visit(item, [...path, key]));
    }
  };
  visit(value);
  return previews;
};

const sdkResponseSummary = (value: any) => {
  if (!value) return null;
  const errorMessage = value.error?.message || (typeof value.error === 'string' ? value.error : '');
  if (errorMessage) {
    const friendlyMessage = friendlySdkError(errorMessage);
    const errorType = value.error?.type ? sdkErrorTypeLabel(value.error.type) : '';
    return {
      title: '请求失败',
      subtitle: friendlyMessage,
      stats: [
        { label: '错误', value: compactSdkValue(friendlyMessage) },
        ...(errorType ? [{ label: '归因', value: errorType }] : []),
        ...(value.error?.code ? [{ label: '代码', value: String(value.error.code) }] : []),
      ],
      groups: [] as SdkSummaryGroup[],
    };
  }

  if (value.object === 'list' && Array.isArray(value.data)) {
    const capabilities = Array.from(new Set(value.data.flatMap((item: any) => Array.isArray(item.capabilities) ? item.capabilities : []))).sort();
    const preferredModels = preferredSdkModels(value.data).map((item: any) => item.id).filter(Boolean);
    const legacyModels = legacySdkModels(value.data)
      .map((item: any) => item.id === 'image_upscale' ? 'image_upscale (兼容旧入口)' : item.id)
      .filter(Boolean);
    const globalCapabilities = Object.entries(value.global_capabilities || {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([name]) => name);
    return {
      title: '模型列表返回成功',
      subtitle: '推荐使用 jimeng-* 模型；旧模型 ID 仍保留兼容。',
      stats: [
        { label: '推荐模型', value: preferredModels.length },
        { label: '兼容旧模型', value: legacyModels.length },
        { label: '能力数量', value: capabilities.length },
      ],
      groups: [
        { label: '推荐模型', items: preferredModels },
        { label: '兼容旧模型', items: legacyModels },
        { label: '功能能力', items: capabilities },
        ...(globalCapabilities.length ? [{ label: '全局能力', items: globalCapabilities }] : []),
      ] as SdkSummaryGroup[],
    };
  }

  const taskId = extractTaskIdFromSdkResponse(value);
  if (taskId) {
    const queue = sdkQueueSummary(value);
    return {
      title: '任务已提交',
      subtitle: pollPathForSdkResponse(value) ? `可继续轮询 ${pollPathForSdkResponse(value)}` : '后端已返回任务标识。',
      stats: [
        { label: '任务 ID', value: compactSdkValue(taskId) },
        { label: '状态', value: value.status || value.state || '-' },
        { label: 'submit_id', value: compactSdkValue(value.submit_id || value.metadata?.submit_id || '-') },
        ...queue.stats,
      ],
      groups: [
        { label: '返回字段', items: [value.object, value.task_type, value.metadata?.dreamina_model, value.metadata?.task_type].filter(Boolean).slice(0, 8) },
        ...(queue.parts.length ? [{ label: 'Queue detail', items: queue.parts }] : []),
      ] as SdkSummaryGroup[],
    };
  }

  const keys = typeof value === 'object' ? Object.keys(value) : [];
  return {
    title: '接口响应',
    subtitle: '返回内容已收起，展开 JSON 可查看完整字段。',
    stats: [
      { label: '类型', value: Array.isArray(value) ? 'array' : typeof value },
      { label: '字段数', value: keys.length || '-' },
      { label: 'object', value: value.object || '-' },
    ],
    groups: [
      { label: '返回字段', items: keys.slice(0, 12) },
    ] as SdkSummaryGroup[],
  };
};

const appendSdkFormValue = (form: FormData, key: string, value: any) => {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) appendSdkFormValue(form, key, item);
    return;
  }
  if (typeof value === 'object') {
    form.append(key, JSON.stringify(value));
    return;
  }
  form.append(key, String(value));
};

const sdkRequestPreview = () => {
  try {
    const endpoint = sdkEndpoint();
    const payload = buildSdkPayload();
    return {
      method: endpoint.method,
      url: `${window.location.origin}${endpoint.path}`,
      headers: {
        Authorization: 'Bearer sk-jm-...',
        ...(endpoint.contentType === 'json' && endpoint.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload,
    };
  } catch (error: any) {
    return { error: error.message };
  }
};

const extractTaskIdFromSdkResponse = (value: any) => {
  if (!value) return '';
  const rawId = String(value.id || '');
  if (rawId.startsWith('resp_')) return rawId.slice(5);
  if (rawId.startsWith('video_')) return rawId.slice(6);
  return value.metadata?.task_id || value.task_id || value.id || '';
};

const pollPathForSdkResponse = (value: any) => {
  if (value?.metadata?.poll_url) return value.metadata.poll_url;
  if (value?.poll_url) return value.poll_url;
  if (!value?.id) return '';
  const id = String(value.id);
  if (id.startsWith('resp_')) return `/v1/responses/${encodeURIComponent(id)}`;
  if (id.startsWith('video_')) return `/v1/videos/${encodeURIComponent(id)}`;
  const taskId = extractTaskIdFromSdkResponse(value);
  return taskId ? `/v1/tasks/${encodeURIComponent(taskId)}` : '';
};

const sdkTaskPreviewUrl = (value: any) => {
  const taskId = extractTaskIdFromSdkResponse(value);
  if (!taskId || !token.value) return '';
  return `/admin/tasks/${encodeURIComponent(taskId)}/content?token=${encodeURIComponent(token.value)}`;
};

const sdkMediaDisplayUrl = (source: any, media: SdkMediaPreview) => {
  return sdkTaskPreviewUrl(source) || media.url;
};

const friendlySdkError = (message: string) => {
  const text = String(message || '').trim();
  let match = text.match(/resolution_type for model (jimeng-image-[\w.-]+) must be one of ([\w, ]+)/);
  if (match) return `${match[1]} 不支持当前图片清晰度，请改成 ${match[2]}。`;
  match = text.match(/video_resolution for model (jimeng-video-[\w._-]+) must be one of ([\w, ]+)/);
  if (match) return `${match[1]} 不支持当前视频清晰度，请改成 ${match[2]}。`;
  match = text.match(/ratio must be one of ([\w:, /-]+)/);
  if (match) return `当前比例不支持，请改成 ${match[1]}。`;
  match = text.match(/mode must be one of ([\w, ]+)/);
  if (match) return `当前视频功能模式不支持，请改成 ${match[1]}。`;
  if (text.includes('CLI session 必须')) return 'CLI session 只能填大于等于 0 的整数，或者留空走默认会话。';
  if (text.includes('metadata 不是合法 JSON')) return text.replace('扩展 metadata', '高级参数里的 metadata');
  return text || '接口测试失败';
};

const newSdkSubmitTraceId = () => `sdk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const sdkProgressLabel = (phase: string) => ({
  idle: '等待发送测试请求',
  received: '已创建请求',
  checking_key: '检查 API Key',
  key_checked: 'API Key 通过',
  preparing_request: '整理请求参数',
  waiting_account: '等待空闲账号',
  account_ready: '账号已锁定',
  creating_task: '创建任务记录',
  task_created: '任务记录已创建',
  waiting_cli_slot: '等待 CLI 执行槽',
  cli_slot_acquired: 'CLI 执行槽已获得',
  credentials_ready: '登录态已换入',
  cli_cold_start: 'CLI 冷启动',
  starting_cli: '启动 CLI 进程',
  waiting_submit_id: '等待即梦 submit_id',
  parsing_submit_id: '解析 CLI 返回',
  queued: '提交完成',
  dry_run: 'Dry run 完成',
  failed: '提交失败',
}[phase] || phase || '等待后端阶段');

const sdkProgressDetailLabel = () => {
  const progress = sdkSubmitProgress.value || {};
  const phase = String(progress.phase || 'idle');
  const details: Record<string, string> = {
    idle: '点击发送后，这里会显示后端和 CLI 的真实执行阶段。',
    received: '前端已发起请求，等待后端接手。',
    checking_key: '后端正在校验 Bearer API Key。',
    key_checked: 'API Key 已通过，继续处理请求。',
    preparing_request: '正在解析 OpenAI SDK 请求参数和上传文件。',
    waiting_account: '正在查找并锁定一个可用的即梦账号。',
    account_ready: '账号已锁定，接下来创建任务记录。',
    creating_task: '正在写入任务记录和扣减本地 Key 用量。',
    task_created: '任务记录已创建，准备启动 dreamina CLI。',
    waiting_cli_slot: '正在等待 Windows 凭据锁，避免多个账号的登录态互相覆盖。',
    cli_slot_acquired: '已经获得 CLI 执行槽，可以安全切换当前账号登录态。',
    credentials_ready: '当前账号的 credential/token 已换入，准备启动 CLI。',
    cli_cold_start: '这是服务启动后的第一次 CLI 提交，正在冷启动 dreamina CLI。',
    starting_cli: '正在启动 dreamina CLI 进程。',
    waiting_submit_id: 'CLI 进程运行中，正在等待即梦返回 submit_id / log_id。',
    parsing_submit_id: 'CLI 已返回，正在解析 submit_id / log_id。',
    queued: '已拿到 submit_id，任务已交给轮询守护进程。',
    dry_run: 'dry_run 只验证参数和路由，不执行 CLI。',
    failed: '请求失败，下面会显示具体错误。',
  };
  return details[phase] || progress.detail || '';
};

const sdkErrorTypeLabel = (type: string) => ({
  auth_error: '鉴权失败',
  quota_error: '本地额度不足',
  account_unavailable: '账号不可用',
  parameter_error: '参数错误',
  account_permission_error: '账号权限不足',
  submit_parse_error: 'submit_id 解析失败',
  network_error: '网络/代理错误',
  cli_error: 'CLI 执行失败',
  unknown_error: '未知错误',
}[type] || type || '');

const sdkProgressElapsedLabel = () => {
  const ms = Number(sdkSubmitProgress.value?.elapsedMs ?? sdkSubmitElapsedMs.value ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
};

const stopSdkProgressPolling = () => {
  if (sdkSubmitProgressTimer !== null) {
    window.clearInterval(sdkSubmitProgressTimer);
    sdkSubmitProgressTimer = null;
  }
};

const fetchSdkSubmitProgress = async (traceId: string) => {
  const key = activeSdkApiKey();
  if (!traceId || !key) return;
  const res = await fetch(`/v1/submit-progress/${encodeURIComponent(traceId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return;
  const data = await res.json();
  sdkSubmitProgress.value = data;
  sdkSubmitElapsedMs.value = Number(data.elapsedMs || sdkSubmitElapsedMs.value || 0);
  if (data.done) stopSdkProgressPolling();
};

const startSdkProgressPolling = (traceId: string) => {
  stopSdkProgressPolling();
  sdkSubmitTraceId.value = traceId;
  sdkSubmitStartedAt.value = Date.now();
  sdkSubmitElapsedMs.value = 0;
  sdkSubmitProgress.value = {
    id: traceId,
    phase: 'received',
    detail: 'frontend request created; waiting for backend stage',
    elapsedMs: 0,
    done: false,
  };
  sdkSubmitProgressTimer = window.setInterval(() => {
    sdkSubmitElapsedMs.value = Date.now() - sdkSubmitStartedAt.value;
    fetchSdkSubmitProgress(traceId).catch(() => {});
  }, 500);
  fetchSdkSubmitProgress(traceId).catch(() => {});
};

const callOpenAiApi = async (path: string, options: any = {}) => {
  const key = activeSdkApiKey();
  if (!key) throw new Error('请先选择或粘贴一个完整 API Key');
  const headers: Record<string, string> = {
    ...(options.headers || {}),
    Authorization: `Bearer ${key}`,
  };
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  delete options.json;
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const rawMessage = data?.error?.message || data?.error || text || `HTTP ${res.status}`;
    const error = new Error(friendlySdkError(rawMessage));
    (error as any).response = data;
    (error as any).rawMessage = rawMessage;
    throw error;
  }
  return data;
};

const runSdkTest = async () => {
  sdkLoading.value = true;
  sdkError.value = '';
  sdkResponse.value = null;
  sdkPollResponse.value = null;
  sdkShowRawResponse.value = false;
  sdkShowRawPollResponse.value = false;
  if (!activeSdkApiKey()) {
    sdkSubmitProgress.value = {
      id: '',
      phase: 'failed',
      error: '缺少完整 API Key',
      elapsedMs: 0,
      done: true,
    };
    sdkSubmitElapsedMs.value = 0;
    sdkError.value = '请先选择或粘贴一个完整 API Key';
    sdkLoading.value = false;
    return;
  }
  const traceId = newSdkSubmitTraceId();
  startSdkProgressPolling(traceId);
  const progressHeaders = { 'X-Jimeng-Submit-Trace': traceId };
  try {
    syncSdkImageResolution();
    syncSdkVideoOptions();
    const endpoint = sdkEndpoint();
    let data: any;
    if (endpoint.method === 'GET') {
      data = await callOpenAiApi(endpoint.path, { method: 'GET', headers: progressHeaders });
    } else if (endpoint.contentType === 'json') {
      data = await callOpenAiApi(endpoint.path, { method: endpoint.method, headers: progressHeaders, json: buildSdkPayload() });
    } else {
      const payload = buildSdkPayload() || {};
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        appendSdkFormValue(form, key, value);
      }
      data = await callOpenAiApi(endpoint.path, { method: endpoint.method, headers: progressHeaders, body: form });
    }
    sdkResponse.value = data;
    refreshOperationalData();
  } catch (error: any) {
    sdkError.value = error.message || '接口测试失败';
    if (error.response) sdkResponse.value = error.response;
  } finally {
    await fetchSdkSubmitProgress(traceId).catch(() => {});
    stopSdkProgressPolling();
    sdkSubmitElapsedMs.value = Date.now() - sdkSubmitStartedAt.value;
    sdkLoading.value = false;
  }
};

const pollSdkResult = async () => {
  const path = pollPathForSdkResponse(sdkResponse.value);
  if (!path) {
    sdkError.value = '当前响应里没有可轮询的任务 ID';
    return;
  }
  sdkPolling.value = true;
  sdkError.value = '';
  sdkShowRawPollResponse.value = false;
  try {
    sdkPollResponse.value = await callOpenAiApi(path, { method: 'GET' });
    refreshOperationalData();
  } catch (error: any) {
    sdkError.value = error.message || '轮询失败';
    if (error.response) sdkPollResponse.value = error.response;
  } finally {
    sdkPolling.value = false;
  }
};

const clearSdkResult = () => {
  stopSdkProgressPolling();
  sdkResponse.value = null;
  sdkPollResponse.value = null;
  sdkSubmitProgress.value = null;
  sdkSubmitTraceId.value = '';
  sdkSubmitStartedAt.value = 0;
  sdkSubmitElapsedMs.value = 0;
  sdkError.value = '';
  sdkShowRawResponse.value = false;
  sdkShowRawPollResponse.value = false;
};

const openTaskById = async (id: string) => {
  if (!id) return;
  try {
    const res = await authFetch(`/admin/tasks/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (res.ok) {
      currentTab.value = 'tasks';
      taskDetail.value = data;
      await fetchTasks(1);
    } else {
      errorMessage.value = data.error || '任务详情加载失败';
    }
  } catch (error: any) {
    errorMessage.value = error.message || '任务详情加载失败';
  }
};

const openSdkTaskInAdmin = () => {
  const taskId = extractTaskIdFromSdkResponse(sdkResponse.value);
  if (!taskId) return;
  taskFilterStatus.value = '';
  taskFilterPrompt.value = '';
  taskFilterError.value = '';
  taskFilterAccountId.value = '';
  openTaskById(taskId);
};

const nativeCopy = async (text: string) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    successMessage.value = '已复制';
  } catch (e: any) {
    nativeError.value = e.message || '复制失败';
  }
};

const ensureNativeAccount = () => {
  if (nativeAccountId.value) return true;
  nativeError.value = '请先选择一个已授权账号实例';
  return false;
};

const fetchAccounts = async () => {
  try {
    const res = await authFetch('/admin/accounts');
    const data = await res.json();
    console.log('[fetchAccounts]', data);
    accounts.value = Array.isArray(data) ? data : [];
    if (!nativeAccountId.value && accounts.value.length) {
      nativeAccountId.value = accounts.value[0].id;
    }
  } catch (error) {
    console.error("Failed to fetch accounts", error);
  }
};

const checkAccount = async (id: string) => {
  checkingId.value = id;
  errorMessage.value = '';
  try {
    const res = await authFetch(`/admin/accounts/${id}/check`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.account) {
      const index = accounts.value.findIndex((a: any) => a.id === id);
      if (index !== -1) accounts.value[index] = { ...accounts.value[index], ...data.account };
      const seconds = data.elapsedMs ? `，耗时 ${(data.elapsedMs / 1000).toFixed(1)} 秒` : '';
      successMessage.value = `账号状态已刷新：${data.account.name}${seconds}`;
    } else {
      if (data.account) {
        const index = accounts.value.findIndex((a: any) => a.id === id);
        if (index !== -1) accounts.value[index] = { ...accounts.value[index], ...data.account };
      }
      errorMessage.value = data.error || `检测账号 ${id} 状态失败`;
    }
  } catch (e: any) {
    errorMessage.value = `检测账号 ${id} 状态失败: ${e.message}`;
    console.error(`检测账号 ${id} 状态失败:`, e);
  } finally {
    checkingId.value = null;
  }
};

const setupNewAccount = async () => {
  errorMessage.value = '';
  successMessage.value = '';
  createAccountModal.value = { show: true, name: '', error: '' };
};

const createNewAccount = async () => {
  errorMessage.value = '';
  successMessage.value = '';
  const name = createAccountModal.value.name.trim();
  if (!name) {
    createAccountModal.value.error = '请输入账号实例名称';
    return;
  }
  loading.value = true;
  try {
    const res = await authFetch('/admin/accounts/login', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      errorMessage.value = data.error || "发生了未知异常";
      createAccountModal.value.error = data.error || "发生了未知异常";
    } else if (data.account?.id && data.verificationUri) {
      createAccountModal.value.show = false;
      createAccountModal.value.name = '';
      oauthModal.value = { show: true, accountId: data.account.id, accountName: name, verificationUri: data.verificationUri, userCode: data.userCode || '', deviceCode: data.deviceCode || '', expiresAt: data.expiresAt || '', isNewAccount: true };
    } else {
      errorMessage.value = '未获取到 OAuth 授权信息，请重试。';
      createAccountModal.value.error = '未获取到 OAuth 授权信息，请重试。';
    }
    await fetchAccounts();
  } catch (error: any) {
    errorMessage.value = "前端网络或解析错误: " + String(error.message || error);
    createAccountModal.value.error = errorMessage.value;
  } finally {
    loading.value = false;
  }
};

const deleteAccount = async (id: string, name: string) => {
  if (!confirm(`确认删除账号「${name}」？\n此操作将同时删除本地 homeDir 目录，不可恢复。`)) return;
  try {
    const res = await authFetch(`/admin/accounts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      successMessage.value = `账号「${name}」已删除`;
      await fetchAccounts();
    } else {
      errorMessage.value = data.error || '删除失败';
    }
  } catch (e: any) {
    errorMessage.value = `删除失败: ${e.message}`;
  }
};

const reloginAccount = async (id: string, name: string) => {
  reloginLoadingId.value = id;
  errorMessage.value = '';
  try {
    const res = await authFetch(`/admin/accounts/${id}/relogin`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.verificationUri) {
      oauthModal.value = { show: true, accountId: id, accountName: name, verificationUri: data.verificationUri, userCode: data.userCode || '', deviceCode: data.deviceCode || '', expiresAt: data.expiresAt || '', isNewAccount: false };
    } else {
      errorMessage.value = data.error || "重新授权失败";
    }
  } catch (e: any) {
    errorMessage.value = `重新授权失败: ${e.message}`;
  } finally {
    reloginLoadingId.value = null;
  }
};


// 关闭 OAuth 弹窗：若是新账号（未完成授权）则同时删除该账号和 homeDir
const closeOAuthModal = async () => {
  const { isNewAccount, accountId, accountName } = oauthModal.value;
  oauthModal.value.show = false;
  if (isNewAccount && accountId) {
    try {
      await authFetch(`/admin/accounts/${accountId}`, { method: 'DELETE' });
      successMessage.value = `已取消账号「${accountName}」的创建。`;
    } catch {}
    await fetchAccounts();
  }
};

const doCheckLogin = async () => {
  if (!oauthModal.value.deviceCode) return alert('deviceCode 丢失，请重新点击"重新授权"。');
  checkLoginLoading.value = true;
  errorMessage.value = '';
  try {
    const res = await authFetch(`/admin/accounts/${oauthModal.value.accountId}/checklogin`, {
      method: 'POST',
      body: JSON.stringify({ deviceCode: oauthModal.value.deviceCode })
    });
    const data = await res.json();
    if (res.status === 202 && data.pending) {
      errorMessage.value = data.message || '您尚未在浏览器完成授权，请先打开授权链接完成验证后再点击确认。';
      return;
    }
    if (res.ok && data.success) {
      const seconds = data.elapsedMs ? `，耗时 ${(data.elapsedMs / 1000).toFixed(1)} 秒` : '';
      successMessage.value = `账号 "${oauthModal.value.accountName}" 授权成功${seconds}`;
      oauthModal.value.show = false;
      await fetchAccounts();
    } else {
      // 授权失败：关闭弹窗但保留账号（用户可在账号列表里点"重新授权"）
      errorMessage.value = data.error || '授权确认失败，请重试。';
      oauthModal.value.show = false;
      await fetchAccounts();
    }
  } catch (e: any) {
    errorMessage.value = '授权确认失败: ' + e.message;
  } finally {
    checkLoginLoading.value = false;
  }
};

const fetchApiKeys = async () => {
  try {
    const res = await authFetch('/admin/apikeys');
    apikeys.value = await res.json();
  } catch (error) {
    console.error("Fetch apikeys failed:", error);
  }
};

const fetchStats = async () => {
  statsLoading.value = true;
  statsError.value = '';
  try {
    const res = await authFetch('/admin/stats');
    const data = await res.json();
    if (res.ok) {
      stats.value = data;
    } else {
      statsError.value = data.error || '加载运行概览失败';
    }
  } catch (error: any) {
    statsError.value = error.message || '加载运行概览失败';
  } finally {
    statsLoading.value = false;
  }
};

const refreshOperationalData = async () => {
  if (!token.value) return;
  await Promise.allSettled([
    fetchStats(),
    fetchAccounts(),
    fetchApiKeys(),
    currentTab.value === 'tasks' ? fetchTasks(taskPage.value) : Promise.resolve(),
  ]);
};

const generateApiKey = async () => {
  if (!apiKeyOwner.value) return alert('请输入拥有者标识');
  errorMessage.value = '';
  loading.value = true;
  try {
    const res = await authFetch('/admin/apikeys', {
      method: 'POST',
      body: JSON.stringify({ owner: apiKeyOwner.value, quota: apiKeyQuota.value, boundAccountId: apiKeyBoundAccountId.value || null })
    });
    const data = await res.json();
    if (res.ok) {
      apiKeyResult.value = data.key;
      apiKeyOwner.value = '';
      apiKeyQuota.value = null;
      apiKeyBoundAccountId.value = '';
      await fetchApiKeys();
    } else {
      errorMessage.value = data.error || "生成失败";
    }
  } catch (error: any) {
    errorMessage.value = "生成出错: " + error.message;
  } finally {
    loading.value = false;
  }
};

const toggleRevealKey = (id: string) => {
  const s = new Set(revealedKeyIds.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  revealedKeyIds.value = s;
};

const copyKey = (text: string) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板！')).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
};
const fallbackCopy = (text: string) => {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  alert('已复制到剪贴板！');
};

const toggleApiKey = async (id: string) => {
  try {
    const res = await authFetch(`/admin/apikeys/${id}/toggle`, { method: 'PUT' });
    const data = await res.json();
    if (res.ok) {
      const index = apikeys.value.findIndex((k: any) => k.id === id);
      if (index !== -1) apikeys.value[index] = { ...apikeys.value[index], ...data };
    }
  } catch (e: any) {
    alert('操作失败: ' + e.message);
  }
};

const deleteApiKey = async (id: string, owner: string) => {
  if (!confirm(`确定要删除令牌 "${owner}" 吗？此操作不可撤销。`)) return;
  try {
    const res = await authFetch(`/admin/apikeys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      apikeys.value = apikeys.value.filter((k: any) => k.id !== id);
    } else {
      const data = await res.json();
      alert('删除失败: ' + (data.error || '未知错误'));
    }
  } catch (e: any) {
    alert('删除失败: ' + e.message);
  }
};

const maskKey = (key: string) => {
  if (!key) return '';
  return key.slice(0, 10) + '••••••••••••••••••••' + key.slice(-4);
};

const openRebindModal = (key: any) => {
  rebindModal.value = { show: true, keyId: key.id, keyOwner: key.owner, currentBoundId: key.boundAccount?.id || '' };
  rebindNewAccountId.value = key.boundAccount?.id || '';
};

const rebindApiKey = async () => {
  try {
    const res = await authFetch(`/admin/apikeys/${rebindModal.value.keyId}/rebind`, {
      method: 'PUT',
      body: JSON.stringify({ boundAccountId: rebindNewAccountId.value || null })
    });
    const data = await res.json();
    if (res.ok) {
      const index = apikeys.value.findIndex((k: any) => k.id === rebindModal.value.keyId);
      if (index !== -1) apikeys.value[index] = { ...apikeys.value[index], ...data };
      rebindModal.value.show = false;
    } else {
      alert('改绑失败: ' + (data.error || '未知错误'));
    }
  } catch (e: any) {
    alert('改绑失败: ' + e.message);
  }
};

const fetchTasks = async (page = taskPage.value) => {
  taskLoading.value = true;
  try {
    const params = new URLSearchParams({ page: String(page), limit: String(taskLimit) });
    if (taskFilterStatus.value) params.set('status', taskFilterStatus.value);
    if (taskFilterPrompt.value) params.set('prompt', taskFilterPrompt.value);
    if (taskFilterError.value) params.set('error', taskFilterError.value);
    if (taskFilterAccountId.value) params.set('accountId', taskFilterAccountId.value);
    const res = await authFetch(`/admin/tasks?${params}`);
    const data = await res.json();
    tasks.value = data.tasks || [];
    taskTotal.value = data.total || 0;
    taskPage.value = page;
  } catch (e: any) {
    errorMessage.value = '获取任务列表失败: ' + e.message;
  } finally {
    taskLoading.value = false;
  }
};

const clearTaskFilters = () => {
  taskFilterStatus.value = '';
  taskFilterPrompt.value = '';
  taskFilterError.value = '';
  taskFilterAccountId.value = '';
};

const inspectFailurePrompt = (item: any) => {
  currentTab.value = 'tasks';
  taskFilterStatus.value = 'FAILED';
  taskFilterPrompt.value = item.prompt || '';
  taskFilterError.value = '';
  taskFilterAccountId.value = '';
  fetchTasks(1);
};

const inspectFailureReason = (item: any) => {
  currentTab.value = 'tasks';
  taskFilterStatus.value = 'FAILED';
  taskFilterPrompt.value = '';
  taskFilterError.value = item.reason || '';
  taskFilterAccountId.value = '';
  fetchTasks(1);
};

const openRiskWithPrompt = (prompt: string, model = '', type = '') => {
  currentTab.value = 'risk';
  riskPrompt.value = prompt || '';
  riskModel.value = model || '';
  riskType.value = type || '';
  if (riskPrompt.value) checkPromptRisk();
};

const checkPromptRisk = async () => {
  riskError.value = '';
  riskResult.value = null;
  riskShowAllMatches.value = false;
  riskShowAllReasons.value = false;
  if (!riskPrompt.value.trim()) {
    riskError.value = '请输入要预检的提示词';
    return;
  }

  riskLoading.value = true;
  try {
    const res = await authFetch('/admin/prompt-risk', {
      method: 'POST',
      body: JSON.stringify({
        prompt: riskPrompt.value,
        model: riskModel.value || undefined,
        type: riskType.value || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      riskResult.value = data;
    } else {
      riskError.value = data.error || '预检失败';
    }
  } catch (e: any) {
    riskError.value = e.message || '预检失败';
  } finally {
    riskLoading.value = false;
  }
};

const clearPromptRisk = () => {
  riskPrompt.value = '';
  riskModel.value = '';
  riskType.value = '';
  riskResult.value = null;
  riskError.value = '';
  riskShowAllMatches.value = false;
  riskShowAllReasons.value = false;
};

const riskLevelLabel = (level: string) => ({
  clear: '未命中历史风险',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
}[level] || level);

const riskVisibleMatches = () => {
  const matches = riskResult.value?.matches || [];
  return riskShowAllMatches.value ? matches : matches.slice(0, 6);
};

const riskHiddenMatchCount = () => Math.max(0, (riskResult.value?.matches?.length || 0) - 6);

const riskVisibleReasons = () => {
  const reasons = riskResult.value?.topReasons || [];
  return riskShowAllReasons.value ? reasons : reasons.slice(0, 4);
};

const riskHiddenReasonCount = () => Math.max(0, (riskResult.value?.topReasons?.length || 0) - 4);

const openRiskMatchTask = (item: any) => {
  clearTaskFilters();
  openTaskById(item.id);
};

const inspectAccountTasks = (accountId: string) => {
  currentTab.value = 'tasks';
  taskFilterAccountId.value = accountId;
  taskFilterStatus.value = '';
  taskFilterPrompt.value = '';
  taskFilterError.value = '';
  fetchTasks(1);
};

const inspectFailedTask = (task: any) => {
  currentTab.value = 'tasks';
  taskFilterStatus.value = 'FAILED';
  taskFilterPrompt.value = task.prompt || '';
  taskFilterError.value = '';
  taskFilterAccountId.value = task.account?.id || '';
  taskDetail.value = task;
  fetchTasks(1);
};

const refreshTaskLiveStatus = async () => {
  if (!taskDetail.value?.id) return;
  taskLiveLoading.value = true;
  taskLiveError.value = '';
  try {
    const res = await authFetch(`/admin/tasks/${encodeURIComponent(taskDetail.value.id)}/live`);
    const data = await res.json();
    if (res.ok) {
      taskLiveStatus.value = data;
    } else {
      taskLiveError.value = data.error || '查询官方状态失败';
    }
  } catch (e: any) {
    taskLiveError.value = e.message || '查询官方状态失败';
  } finally {
    taskLiveLoading.value = false;
  }
};

const stopTrackingTask = async (id: string) => {
  if (!confirm('确认停止本地跟踪该任务？这不会取消即梦侧已经提交的生成。')) return;
  failingId.value = id;
  try {
    const res = await authFetch(`/admin/tasks/${id}/stop-tracking`, {
      method: 'POST',
      body: JSON.stringify({ reason: failReason.value || '管理员停止本地跟踪；不代表即梦侧已取消生成' })
    });
    const data = await res.json();
    if (res.ok) {
      successMessage.value = '已停止本地跟踪';
      failReason.value = '';
      taskDetail.value = null;
      taskLiveStatus.value = null;
      await fetchTasks();
    } else {
      errorMessage.value = data.error || '操作失败';
    }
  } catch (e: any) {
    errorMessage.value = e.message;
  } finally {
    failingId.value = null;
  }
};

const retryTask = async (id: string) => {
  if (!confirm('确认重置任务为 PROCESSING？轮询守护进程将重新拉取。')) return;
  retryingId.value = id;
  try {
    const res = await authFetch(`/admin/tasks/${id}/retry`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      successMessage.value = '任务已重置为 PROCESSING';
      await fetchTasks();
    } else {
      errorMessage.value = data.error || '操作失败';
    }
  } catch (e: any) {
    errorMessage.value = e.message;
  } finally {
    retryingId.value = null;
  }
};

const openTaskDetail = (task: any) => {
  taskDetail.value = task;
  taskLiveStatus.value = null;
  taskLiveError.value = '';
  if (task?.jimengSubmitId) {
    refreshTaskLiveStatus();
  }
};

const fetchNativeSessions = async () => {
  if (!ensureNativeAccount()) return;
  nativeLoading.value = 'sessions';
  nativeError.value = '';
  try {
    const params = new URLSearchParams({
      accountId: nativeAccountId.value,
      maxCount: String(nativeSessionMaxCount.value || 30),
    });
    const res = await authFetch(`/admin/native/sessions?${params}`);
    const data = await res.json();
    if (res.ok) {
      nativeSessionsResult.value = data;
      nativeShowSessionRaw.value = false;
    }
    else nativeError.value = data.error || '查询 CLI 会话失败';
  } catch (e: any) {
    nativeError.value = e.message;
  } finally {
    nativeLoading.value = '';
  }
};

const createNativeSession = async () => {
  if (!ensureNativeAccount()) return;
  nativeLoading.value = 'session-create';
  nativeError.value = '';
  try {
    const res = await authFetch('/admin/native/sessions', {
      method: 'POST',
      body: JSON.stringify({ accountId: nativeAccountId.value, name: nativeSessionName.value || undefined }),
    });
    const data = await res.json();
    if (res.ok) {
      nativeSessionsResult.value = data;
      nativeSessionName.value = '';
      nativeShowSessionRaw.value = false;
    } else {
      nativeError.value = data.error || '创建 CLI 会话失败';
    }
  } catch (e: any) {
    nativeError.value = e.message;
  } finally {
    nativeLoading.value = '';
  }
};

const searchNativeSession = async () => {
  if (!ensureNativeAccount()) return;
  nativeLoading.value = 'session-search';
  nativeError.value = '';
  try {
    const params = new URLSearchParams({
      accountId: nativeAccountId.value,
      name: nativeSessionSearchName.value,
    });
    const res = await authFetch(`/admin/native/sessions/search?${params}`);
    const data = await res.json();
    if (res.ok) {
      nativeSessionsResult.value = data;
      nativeShowSessionRaw.value = false;
    } else nativeError.value = data.error || '搜索 CLI 会话失败';
  } catch (e: any) {
    nativeError.value = e.message;
  } finally {
    nativeLoading.value = '';
  }
};

const renameNativeSession = async () => {
  if (!ensureNativeAccount()) return;
  nativeLoading.value = 'session-rename';
  nativeError.value = '';
  try {
    const res = await authFetch(`/admin/native/sessions/${encodeURIComponent(nativeSessionId.value)}`, {
      method: 'PUT',
      body: JSON.stringify({ accountId: nativeAccountId.value, name: nativeSessionNewName.value }),
    });
    const data = await res.json();
    if (res.ok) {
      nativeSessionsResult.value = data;
      nativeShowSessionRaw.value = false;
    } else nativeError.value = data.error || '重命名 CLI 会话失败';
  } catch (e: any) {
    nativeError.value = e.message;
  } finally {
    nativeLoading.value = '';
  }
};

const deleteNativeSession = async () => {
  if (!ensureNativeAccount()) return;
  if (!nativeSessionId.value || !confirm(`确认删除 CLI 会话 ${nativeSessionId.value}？历史会被 CLI 移回默认会话。`)) return;
  nativeLoading.value = 'session-delete';
  nativeError.value = '';
  try {
    const res = await authFetch(`/admin/native/sessions/${encodeURIComponent(nativeSessionId.value)}`, {
      method: 'DELETE',
      body: JSON.stringify({ accountId: nativeAccountId.value }),
    });
    const data = await res.json();
    if (res.ok) {
      nativeSessionsResult.value = data;
      nativeShowSessionRaw.value = false;
    } else nativeError.value = data.error || '删除 CLI 会话失败';
  } catch (e: any) {
    nativeError.value = e.message;
  } finally {
    nativeLoading.value = '';
  }
};

const fetchNativeTasks = async () => {
  if (!ensureNativeAccount()) return;
  nativeLoading.value = 'tasks';
  nativeError.value = '';
  try {
    const params = new URLSearchParams({
      accountId: nativeAccountId.value,
      limit: String(nativeTaskLimit.value || 20),
      offset: String(nativeTaskOffset.value || 0),
    });
    if (nativeTaskStatus.value) params.set('gen_status', nativeTaskStatus.value);
    if (nativeTaskType.value) params.set('gen_task_type', nativeTaskType.value);
    if (nativeTaskSubmitId.value) params.set('submit_id', nativeTaskSubmitId.value);
    const res = await authFetch(`/admin/native/tasks?${params}`);
    const data = await res.json();
    if (res.ok) {
      nativeTasksResult.value = data;
      nativeShowTaskRaw.value = false;
    }
    else nativeError.value = data.error || '查询 CLI 任务失败';
  } catch (e: any) {
    nativeError.value = e.message;
  } finally {
    nativeLoading.value = '';
  }
};

const queryNativeResult = async () => {
  if (!ensureNativeAccount()) return;
  nativeLoading.value = 'query';
  nativeError.value = '';
  try {
    const params = new URLSearchParams({
      accountId: nativeAccountId.value,
      submit_id: nativeQuerySubmitId.value,
    });
    if (nativeQueryDownload.value) params.set('download', '1');
    if (nativeQueryDownloadDirName.value) params.set('downloadDirName', nativeQueryDownloadDirName.value);
    const res = await authFetch(`/admin/native/query-result?${params}`);
    const data = await res.json();
    if (res.ok) {
      nativeQueryResult.value = data;
      nativeShowQueryRaw.value = false;
    }
    else nativeError.value = data.error || '查询 CLI 原生结果失败';
  } catch (e: any) {
    nativeError.value = e.message;
  } finally {
    nativeLoading.value = '';
  }
};

const statusLabel = (s: string) => ({ PENDING: '待处理', PROCESSING: '生成中', SUCCESS: '已完成', FAILED: '已失败' }[s] || s);
const statusClass = (s: string) => ({
  PENDING: 'bg-slate-100 text-slate-500',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-600'
}[s] || 'bg-slate-100 text-slate-500');

const initData = () => {
  if (!token.value) return;
  authFetch('/admin/sys/check')
    .then(() => {
      fetchAccounts();
      fetchApiKeys();
      fetchStats();
    })
    .catch(() => {});
};

onMounted(() => {
  initData();
  window.setInterval(() => {
    if (!token.value) return;
    if (['monitor', 'accounts', 'apikeys', 'tasks', 'sdkTest'].includes(currentTab.value)) {
      refreshOperationalData();
    }
  }, 5000);
});
</script>

<template>
  <div v-if="!token" class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-indigo-950 px-4">
    <div class="max-w-md w-full bg-white/10 backdrop-blur-md rounded-3xl shadow-2xl overflow-hidden border border-white/20 p-8 text-center">
      <h2 class="text-2xl font-extrabold text-white tracking-tight mb-8">即梦调度中枢 (Jimeng Hub)</h2>
      <form @submit.prevent="doLogin" class="space-y-6">
        <input v-model="loginPassword" type="password" required class="w-full bg-black/20 border border-white/10 text-white px-5 py-4 rounded-xl placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="管理员密码" />
        <p v-if="loginError" class="text-red-400 text-xs text-left">{{ loginError }}</p>
        <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl">登录控制台</button>
      </form>
    </div>
  </div>

  <div v-else class="flex flex-col lg:flex-row min-h-screen bg-slate-100 text-slate-800">
    <aside class="w-full lg:w-72 bg-slate-950 text-white flex flex-col shadow-xl z-10 p-4 lg:p-5 shrink-0">
      <div class="mb-4 lg:mb-5 border-b border-white/10 pb-4 lg:pb-5">
        <p class="text-xs font-bold text-indigo-300 tracking-wider uppercase">Jimeng Hub</p>
        <h1 class="text-xl lg:text-2xl font-black mt-1">即梦调度台</h1>
        <p class="text-xs text-slate-400 mt-2 leading-5 hidden sm:block">账号池、任务队列、SDK 接入和运行监控</p>
      </div>
      <nav class="flex lg:flex-col gap-3 lg:gap-5 overflow-x-auto lg:overflow-y-auto lg:pr-1 pb-1 lg:pb-0">
        <div v-for="group in navGroups" :key="group.title" class="min-w-[180px] lg:min-w-0">
          <p class="px-3 text-[11px] font-black text-slate-500 tracking-wider mb-2">{{ group.title }}</p>
          <div class="space-y-1">
            <button
              v-for="item in group.items"
              :key="item.key"
              @click="setTab(item.key)"
              :class="navItemClass(item.key)"
              class="w-full text-left px-3 py-2.5 rounded-xl font-semibold transition flex items-center justify-between border"
            >
              <span>{{ item.label }}</span>
              <span v-if="navBadge(item) !== '' && navBadge(item) !== undefined" class="text-[11px] font-black px-2 py-0.5 rounded-full" :class="currentTab === item.key ? 'bg-slate-100 text-slate-500' : 'bg-white/10 text-slate-400'">{{ navBadge(item) }}</span>
            </button>
          </div>
        </div>
      </nav>
      <div class="hidden lg:block rounded-xl bg-slate-900 border border-white/10 p-4 my-4 space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span>Base URL</span>
          <span class="font-mono text-indigo-300">:3000/v1</span>
        </div>
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span>状态</span>
          <span class="font-mono text-emerald-300">online</span>
        </div>
      </div>
      <button @click="doLogout" class="hidden lg:block w-full bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 py-3 rounded-xl font-bold transition">退出系统</button>
    </aside>

    <main class="flex-1 p-4 lg:p-8 overflow-y-auto min-h-0 lg:h-screen">

      <div class="mb-6 bg-white border border-slate-200 shadow-sm px-4 lg:px-6 py-4 lg:py-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
        <div class="min-w-0">
          <p class="text-xs font-bold text-indigo-600 tracking-wider uppercase">Console</p>
          <h2 class="text-2xl lg:text-3xl font-black text-slate-900 mt-1">{{ pageTitle() }}</h2>
          <p class="text-sm text-slate-500 mt-1">{{ pageSubtitle() }}</p>
        </div>
        <div class="flex flex-wrap gap-2 text-xs font-semibold">
          <span class="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full">Base URL: :3000/v1</span>
          <span v-if="currentTab === 'monitor'" class="px-3 py-1.5 rounded-full" :class="operationHealth().className">{{ operationHealth().label }}</span>
          <button v-if="currentTab !== 'monitor'" @click="setTab('monitor')" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full">回到监控</button>
        </div>
      </div>

      <!-- 创建账号实例弹窗 -->
      <div v-if="createAccountModal.show" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" @click.self="!loading && (createAccountModal.show = false)">
        <form @submit.prevent="createNewAccount" class="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
          <div class="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 class="font-black text-slate-900 text-lg">部署新账号实例</h3>
              <p class="text-sm text-slate-500 mt-1">为这个即梦账号创建独立运行目录和凭证环境</p>
            </div>
            <button type="button" @click="createAccountModal.show = false" :disabled="loading" class="text-slate-400 hover:text-slate-600 text-2xl leading-none disabled:opacity-40">&times;</button>
          </div>
          <div class="px-6 py-5 space-y-4">
            <div>
              <label class="block text-sm font-bold text-slate-700 mb-2">账号实例名称</label>
              <input v-model.trim="createAccountModal.name" :disabled="loading" autofocus placeholder="例如 vip_account_1" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50" />
              <p class="text-xs text-slate-400 mt-2">建议用英文、数字和下划线，便于后续识别和筛选。</p>
            </div>
            <div v-if="createAccountModal.error" class="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">{{ createAccountModal.error }}</div>
          </div>
          <div class="px-6 pb-6 flex gap-3">
            <button type="button" @click="createAccountModal.show = false" :disabled="loading" class="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition">取消</button>
            <button type="submit" :disabled="loading" class="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition">
              {{ loading ? '创建中...' : '创建并获取授权' }}
            </button>
          </div>
        </form>
      </div>

      <!-- OAuth Device Flow 授权弹窗 -->
      <div v-if="oauthModal.show" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-md">
          <!-- 头部 -->
          <div class="px-6 pt-6 pb-4 border-b border-slate-100">
            <div class="flex items-center justify-between">
              <h3 class="font-bold text-lg text-slate-800">授权登录</h3>
              <button @click="closeOAuthModal" class="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <p class="text-sm text-slate-500 mt-1">账号：<span class="font-semibold text-slate-700">{{ oauthModal.accountName }}</span></p>
          </div>

          <div class="px-6 py-5 space-y-4">
            <!-- 步骤说明 -->
            <ol class="text-sm text-slate-500 space-y-1 list-decimal list-inside">
              <li>点击下方按钮打开授权页面</li>
              <li>在授权页面输入下方验证码</li>
              <li>用即梦 VIP 账号登录并确认</li>
              <li>回到这里点击「我已完成授权」</li>
            </ol>

            <!-- 授权链接 -->
            <div class="rounded-xl border border-indigo-200 bg-indigo-50 overflow-hidden">
              <div class="flex items-center justify-between px-3 py-2 border-b border-indigo-200 bg-indigo-100/60">
                <span class="text-xs font-semibold text-indigo-600">授权链接</span>
                <button @click="copyVerificationUri" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded hover:bg-indigo-200 transition">
                  {{ verificationUriCopied ? '✓ 已复制' : '复制' }}
                </button>
              </div>
              <a :href="oauthModal.verificationUri" target="_blank" class="block text-xs text-indigo-600 font-mono px-3 py-2.5 break-all leading-5 hover:bg-indigo-100/50 transition">{{ oauthModal.verificationUri }}</a>
            </div>

            <!-- 验证码 -->
            <div class="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
              <div class="flex items-center justify-between px-3 py-2 border-b border-amber-200 bg-amber-100/60">
                <span class="text-xs font-semibold text-amber-700">验证码</span>
                <div class="flex items-center gap-2">
                  <span v-if="oauthModal.expiresAt" class="text-xs text-amber-500">有效期至 {{ oauthModal.expiresAt }}</span>
                  <button @click="copyUserCode" class="text-xs font-semibold text-amber-700 hover:text-amber-900 px-2 py-0.5 rounded hover:bg-amber-200 transition">
                    {{ userCodeCopied ? '✓ 已复制' : '复制' }}
                  </button>
                </div>
              </div>
              <div class="px-3 py-3 text-center">
                <span class="text-base font-black tracking-[0.2em] text-amber-800 font-mono select-all break-all">{{ oauthModal.userCode }}</span>
              </div>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div v-if="checkLoginLoading" class="px-6 pb-3 text-xs text-amber-600">正在调用即梦 CLI 确认授权，通常几秒内返回。未完成网页授权时不会长时间卡住。</div>
          <div class="px-6 pb-6 flex gap-3">
            <button @click="closeOAuthModal" class="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl hover:bg-slate-50 transition">取消</button>
            <button @click="doCheckLogin" :disabled="checkLoginLoading" class="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition">
              {{ checkLoginLoading ? '确认授权中...' : '我已完成授权' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Global Error/Success -->
      <div v-if="errorMessage" class="mb-6 bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl flex justify-between items-center">
        <span class="text-sm font-medium">{{ errorMessage }}</span>
        <button @click="errorMessage = ''" class="text-red-400 hover:text-red-600 font-bold text-lg ml-4">×</button>
      </div>
      <div v-if="successMessage" class="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-700 px-5 py-4 rounded-xl flex justify-between items-center">
        <span class="text-sm font-medium">{{ successMessage }}</span>
        <button @click="successMessage = ''" class="text-emerald-400 hover:text-emerald-600 font-bold text-lg ml-4">×</button>
      </div>

      <!-- ========== TAB: MONITOR ========== -->
      <div v-if="currentTab === 'monitor'" class="space-y-6">
        <div class="bg-white border border-slate-200 shadow-sm p-5 flex flex-col 2xl:flex-row 2xl:items-center 2xl:justify-between gap-5">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1">
            <div class="border border-slate-200 bg-slate-50 p-4">
              <p class="text-xs font-black text-slate-500">1. 账号就绪</p>
              <p class="text-2xl font-black text-slate-900 mt-2">{{ availableAccountCount() }}</p>
              <p class="text-xs text-slate-500 mt-1">可立即调度的账号</p>
            </div>
            <div class="border border-slate-200 bg-slate-50 p-4">
              <p class="text-xs font-black text-slate-500">2. 队列压力</p>
              <p class="text-2xl font-black text-slate-900 mt-2">{{ processingTaskCount() }}</p>
              <p class="text-xs text-slate-500 mt-1">正在执行的 CLI 任务</p>
            </div>
            <div class="border border-slate-200 bg-slate-50 p-4">
              <p class="text-xs font-black text-slate-500">3. 今日产出</p>
              <p class="text-2xl font-black text-slate-900 mt-2">{{ todaySuccessCount() }}</p>
              <p class="text-xs text-slate-500 mt-1">已完成创意数</p>
            </div>
            <div class="border border-slate-200 bg-slate-50 p-4">
              <p class="text-xs font-black text-slate-500">4. 当前判断</p>
              <div class="flex items-center gap-2 mt-2">
                <span class="w-2.5 h-2.5 rounded-full" :class="operationHealth().accentClass"></span>
                <span class="text-lg font-black px-2 py-1 rounded-lg" :class="operationHealth().className">{{ operationHealth().label }}</span>
              </div>
              <p class="text-xs text-slate-500 mt-1">{{ operationHealth().detail }}</p>
            </div>
          </div>
          <div class="flex flex-wrap 2xl:flex-col gap-2 2xl:w-40">
            <button @click="fetchStats" :disabled="statsLoading" class="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm">刷新数据</button>
            <button @click="openTaskList('PROCESSING')" class="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-2.5 rounded-lg font-bold text-sm">处理中任务</button>
            <button @click="openTaskList('FAILED')" class="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-2.5 rounded-lg font-bold text-sm">失败任务</button>
          </div>
        </div>

        <div v-if="statsError" class="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl text-sm font-medium">{{ statsError }}</div>
        <div v-if="statsLoading && !stats" class="text-center py-20 text-slate-400 bg-white border border-slate-200">运行数据加载中...</div>

        <template v-if="stats">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <div class="bg-white border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">账号池</p>
              <p class="text-3xl font-black text-slate-800 mt-2">{{ stats.accounts.total }}</p>
              <p class="text-xs text-slate-500 mt-1">可用 {{ stats.accounts.idle }} · 忙碌 {{ stats.accounts.busy }} · 异常 {{ stats.accounts.error }}</p>
            </div>
            <div class="bg-white border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">任务总数</p>
              <p class="text-3xl font-black text-slate-800 mt-2">{{ stats.tasks.total }}</p>
              <p class="text-xs text-slate-500 mt-1">处理中 {{ stats.tasks.processing }} · 待处理 {{ stats.tasks.pending }}</p>
            </div>
            <div class="bg-white border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">今日创意</p>
              <p class="text-3xl font-black text-emerald-600 mt-2">{{ stats.tasks.today.success }}</p>
              <p class="text-xs text-slate-500 mt-1">今日提交 {{ stats.tasks.today.total }} · 失败 {{ stats.tasks.today.failed }}</p>
            </div>
            <div class="bg-white border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">失败率</p>
              <p class="text-3xl font-black text-red-500 mt-2">{{ formatRate(stats.failures.rate) }}</p>
              <p class="text-xs text-slate-500 mt-1">今日 {{ formatRate(stats.failures.todayRate) }} · 累计失败 {{ stats.failures.total }}</p>
            </div>
            <div class="bg-white border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">内存占用</p>
              <p class="text-3xl font-black text-slate-800 mt-2">{{ formatBytes(stats.runtime.memory.rss) }}</p>
              <p class="text-xs text-slate-500 mt-1">系统已用 {{ formatRate(stats.runtime.systemMemory.usedPercent / 100) }}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div class="bg-white border border-slate-200 shadow-sm p-6 space-y-4">
              <h3 class="font-black text-slate-800">运行实例</h3>
              <div class="space-y-3 text-sm">
                <div class="flex justify-between gap-4"><span class="text-slate-400">PID</span><span class="font-mono text-slate-700">{{ stats.runtime.pid }}</span></div>
                <div class="flex justify-between gap-4"><span class="text-slate-400">运行时长</span><span class="font-mono text-slate-700">{{ Math.floor(stats.runtime.uptimeSeconds / 60) }} 分钟</span></div>
                <div class="flex justify-between gap-4"><span class="text-slate-400">Node</span><span class="font-mono text-slate-700">{{ stats.runtime.nodeVersion }}</span></div>
                <div class="flex justify-between gap-4"><span class="text-slate-400">平台</span><span class="font-mono text-slate-700">{{ stats.runtime.platform }} · {{ stats.runtime.cpuCount }} CPU</span></div>
                <div class="pt-2 border-t border-slate-100">
                  <p class="text-xs font-bold text-slate-400 mb-1">CLI 路径</p>
                  <p class="text-xs font-mono text-slate-600 break-all">{{ stats.runtime.cliBin }}</p>
                </div>
              </div>
            </div>

            <div class="bg-white border border-slate-200 shadow-sm p-6 xl:col-span-2">
              <div class="flex items-center justify-between mb-4">
                <h3 class="font-black text-slate-800">近 7 天运行走势</h3>
                <span class="text-xs text-slate-400">成功 / 失败 / 处理中</span>
              </div>
              <div class="space-y-3">
                <div v-for="day in stats.failures.timeline" :key="day.dateKey" class="grid grid-cols-[56px_1fr_80px] gap-3 items-center text-xs">
                  <span class="font-semibold text-slate-500">{{ day.label }}</span>
                  <div class="h-8 bg-slate-100 rounded-lg overflow-hidden flex">
                    <div v-if="day.success" class="bg-emerald-400" :style="{ width: barWidth(day.success, Math.max(day.total, 1)) }"></div>
                    <div v-if="day.failed" class="bg-red-400" :style="{ width: barWidth(day.failed, Math.max(day.total, 1)) }"></div>
                    <div v-if="day.processing || day.pending" class="bg-blue-400" :style="{ width: barWidth(day.processing + day.pending, Math.max(day.total, 1)) }"></div>
                  </div>
                  <span class="text-right text-slate-500">{{ day.total }} 条</span>
                </div>
              </div>
            </div>
          </div>

          <div class="bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 class="font-black text-slate-800">账号运行矩阵</h3>
              <span class="text-xs text-slate-400">点击任务可进入筛选后的任务管理</span>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">账号</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">状态</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">积分</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">今日创意</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">处理中</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">失败</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr v-if="stats.accounts.accounts.length === 0"><td colspan="7" class="text-center py-10 text-slate-400">暂无账号数据</td></tr>
                  <tr v-for="row in stats.accounts.accounts" :key="row.id" class="hover:bg-slate-50">
                    <td class="px-4 py-3">
                      <p class="font-semibold text-slate-800">{{ row.name }}</p>
                      <p class="text-xs text-slate-400 font-mono">{{ row.id }}</p>
                    </td>
                    <td class="px-4 py-3"><span class="text-xs font-bold px-2 py-1 rounded-full" :class="accountStatusClass(row.status)">{{ accountStatusLabel(row.status) }}</span></td>
                    <td class="px-4 py-3 text-xs text-slate-500">{{ row.creditBalance ?? '-' }}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">{{ row.todaySuccess }} / {{ row.todayCreatives }}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">{{ row.processingTasks }}</td>
                    <td class="px-4 py-3 text-xs text-red-500">{{ row.failedTasks }} <span class="text-slate-400">今日 {{ row.todayFailed }}</span></td>
                    <td class="px-4 py-3"><button @click="inspectAccountTasks(row.id)" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">查看任务</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div class="bg-white border border-slate-200 shadow-sm p-6 space-y-4">
              <h3 class="font-black text-slate-800">高频失败提示词</h3>
              <div v-if="stats.failures.byPrompt.length === 0" class="text-sm text-slate-400 py-6">暂无失败提示词</div>
              <div v-for="item in stats.failures.byPrompt" :key="`${item.prompt}-${item.model}-${item.type}`" class="border border-slate-100 rounded-xl p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-slate-800 break-words">{{ item.promptPreview }}</p>
                    <p class="text-xs text-slate-400 mt-1">{{ item.type }} · {{ item.model || '-' }} · 最近 {{ item.lastFailedAt ? new Date(item.lastFailedAt).toLocaleString() : '-' }}</p>
                    <p v-if="item.sampleError" class="text-xs text-red-500 mt-2 break-words">{{ shortText(item.sampleError, 110) }}</p>
                  </div>
                    <div class="flex flex-col gap-2 shrink-0">
                      <button @click="inspectFailurePrompt(item)" class="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg">{{ item.count }} 次</button>
                      <button @click="openRiskWithPrompt(item.prompt, item.model, item.type)" class="text-xs font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg">预检</button>
                    </div>
                </div>
              </div>
            </div>

            <div class="bg-white border border-slate-200 shadow-sm p-6 space-y-5">
              <div>
                <h3 class="font-black text-slate-800 mb-4">失败原因排行</h3>
                <div v-if="stats.failures.byReason.length === 0" class="text-sm text-slate-400 py-6">暂无失败原因</div>
                <div v-for="item in stats.failures.byReason" :key="item.reason" class="mb-3">
                  <div class="flex justify-between text-xs mb-1 gap-3">
                    <button @click="inspectFailureReason(item)" class="text-left text-slate-700 hover:text-indigo-600 font-semibold truncate">{{ item.reasonPreview }}</button>
                    <span class="text-red-500 font-bold">{{ item.count }}</span>
                  </div>
                  <div class="h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-red-400" :style="{ width: barWidth(item.count, maxCount(stats.failures.byReason)) }"></div></div>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-slate-100">
                <div>
                  <h4 class="text-sm font-black text-slate-700 mb-3">失败模型</h4>
                  <div v-for="item in stats.failures.byModel" :key="item.model" class="flex justify-between text-xs py-1.5 border-b border-slate-50">
                    <span class="font-mono text-slate-600">{{ item.model }}</span>
                    <span class="font-bold text-red-500">{{ item.count }}</span>
                  </div>
                </div>
                <div>
                  <h4 class="text-sm font-black text-slate-700 mb-3">失败账号</h4>
                  <div v-for="item in stats.failures.byAccount" :key="item.id" class="flex justify-between text-xs py-1.5 border-b border-slate-50">
                    <button @click="inspectAccountTasks(item.id)" class="text-slate-600 hover:text-indigo-600">{{ item.name }}</button>
                    <span class="font-bold text-red-500">{{ item.count }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 class="font-black text-slate-800">最近失败任务</h3>
              <button @click="openTaskList('FAILED')" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">查看全部失败</button>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">提示词</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">模型</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">账号</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">失败原因</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">时间</th>
                    <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr v-if="stats.failures.recent.length === 0"><td colspan="6" class="text-center py-10 text-slate-400">暂无失败任务</td></tr>
                  <tr v-for="task in stats.failures.recent" :key="task.id" class="hover:bg-slate-50">
                    <td class="px-4 py-3 text-xs text-slate-700 max-w-md break-words">{{ shortText(task.prompt, 110) || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">{{ task.model || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-slate-500">{{ task.account?.name || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-red-500 max-w-sm break-words">{{ shortText(task.errorMsg || task.pollErrorMsg, 100) || '-' }}</td>
                    <td class="px-4 py-3 text-xs text-slate-400">{{ new Date(task.updatedAt).toLocaleString() }}</td>
                    <td class="px-4 py-3">
                      <div class="flex gap-2">
                        <button @click="openTaskDetail(task)" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">详情</button>
                        <button @click="inspectFailedTask(task)" class="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg">定位</button>
                        <button @click="openRiskWithPrompt(task.prompt, task.model, task.type)" class="text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg">预检</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>

      <!-- ========== TAB: ACCOUNTS ========== -->
      <div v-if="currentTab === 'accounts'" class="space-y-6">
        <div class="flex items-center justify-between">
          <p class="text-sm text-slate-500">每个账号独立 homeDir 和凭证，用于后端轮询分发任务</p>
          <button @click="setupNewAccount" :disabled="loading" class="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-bold transition">部署新账号实例</button>
        </div>
        <div v-if="accounts.length === 0" class="bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div class="grid grid-cols-1 xl:grid-cols-[1fr_360px]">
            <div class="p-10">
              <p class="text-xs font-bold text-indigo-600 uppercase tracking-wider">Account Pool</p>
              <h3 class="text-3xl font-black text-slate-900 mt-3">还没有可调度账号</h3>
              <p class="text-sm text-slate-500 mt-3 leading-6 max-w-xl">先部署一个即梦账号实例并完成授权，API Key 才能拿到可用账号去提交图片、视频和高清放大任务。</p>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-7">
                <div class="bg-slate-50 border border-slate-100 p-4">
                  <p class="text-xs font-black text-slate-500">1. 部署实例</p>
                  <p class="text-xs text-slate-400 mt-2 leading-5">创建独立账号目录</p>
                </div>
                <div class="bg-slate-50 border border-slate-100 p-4">
                  <p class="text-xs font-black text-slate-500">2. 完成授权</p>
                  <p class="text-xs text-slate-400 mt-2 leading-5">浏览器确认登录态</p>
                </div>
                <div class="bg-slate-50 border border-slate-100 p-4">
                  <p class="text-xs font-black text-slate-500">3. 签发 Key</p>
                  <p class="text-xs text-slate-400 mt-2 leading-5">绑定账号或全局池</p>
                </div>
              </div>
            </div>
            <div class="bg-slate-950 text-white p-8 flex flex-col justify-between">
              <div>
                <p class="text-xs font-bold text-slate-400 uppercase">建议顺序</p>
                <div class="mt-5 space-y-4 text-sm">
                  <div class="flex gap-3"><span class="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-black shrink-0">1</span><span class="text-slate-300">部署第一个 VIP 账号实例</span></div>
                  <div class="flex gap-3"><span class="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-black shrink-0">2</span><span class="text-slate-300">检测积分和状态是否可用</span></div>
                  <div class="flex gap-3"><span class="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-black shrink-0">3</span><span class="text-slate-300">进入 API 令牌分发签发客户端 Key</span></div>
                </div>
              </div>
              <button @click="setupNewAccount" :disabled="loading" class="mt-8 bg-white text-slate-950 hover:bg-indigo-50 disabled:opacity-50 rounded-xl px-5 py-3 text-sm font-black transition">开始部署账号</button>
            </div>
          </div>
        </div>
        <div v-for="acc in accounts" :key="acc.id" class="bg-white shadow-sm border border-slate-200 overflow-hidden">
          <div class="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-1">
                <span class="inline-block w-3 h-3 rounded-full flex-shrink-0" :class="accountDotClass(acc.status)"></span>
                <p class="font-bold text-lg text-slate-800">{{ acc.name }}</p>
                <span class="text-xs font-bold px-2 py-0.5 rounded-full" :class="accountStatusClass(acc.status)">{{ accountStatusLabel(acc.status) }}</span>
              </div>
              <p class="text-xs text-slate-400 font-mono">ID: {{ acc.id }}</p>
              <div v-if="acc.creditBalance" class="mt-1 text-sm text-slate-500">余额: <span class="font-bold text-emerald-600">{{ acc.creditBalance }}</span> 积分 · 最后检查: {{ acc.lastChecked ? new Date(acc.lastChecked).toLocaleString() : '从未' }}</div>
              <div class="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                <span class="bg-slate-100 px-2 py-1 rounded-lg">总任务 {{ getAccountMetrics(acc.id).totalCreatives }}</span>
                <span class="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg">今日成功 {{ getAccountMetrics(acc.id).todaySuccess }}</span>
                <span class="bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">处理中 {{ getAccountMetrics(acc.id).processingTasks }}</span>
                <span class="bg-red-50 text-red-600 px-2 py-1 rounded-lg">失败 {{ getAccountMetrics(acc.id).failedTasks }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button @click="inspectAccountTasks(acc.id)" class="text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                任务
              </button>
              <button @click="checkAccount(acc.id)" :disabled="checkingId === acc.id" class="text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                {{ checkingId === acc.id ? 'CLI 查询中' : '检测状态' }}
              </button>
              <button @click="reloginAccount(acc.id, acc.name)" :disabled="reloginLoadingId === acc.id" class="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                {{ reloginLoadingId === acc.id ? '授权中' : '重新授权' }}
              </button>
              <button @click="deleteAccount(acc.id, acc.name)" class="text-sm font-semibold text-white bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                删除
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== TAB: API KEYS ========== -->
      <div v-if="currentTab === 'apikeys'" class="space-y-6">
        <div class="bg-white p-6 shadow-sm border border-slate-200 space-y-4">
          <h3 class="font-bold text-slate-700 text-sm uppercase tracking-wider">签发新令牌</h3>
          <div class="flex flex-wrap gap-3">
            <input v-model="apiKeyOwner" placeholder="拥有者标识 (如 client_01)" class="flex-1 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-w-[180px]" />
            <input v-model.number="apiKeyQuota" type="number" placeholder="额度上限 (留空=无限)" class="w-52 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <!-- 自定义账号下拉 -->
            <div class="relative">
              <button type="button" @click="showAccountDropdown = !showAccountDropdown" class="flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 rounded-lg text-sm hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500 outline-none min-w-[220px] justify-between">
                <span v-if="!apiKeyBoundAccountId" class="text-slate-500">不绑定（自动分配）</span>
                <template v-else>
                  <template v-for="acc in accounts" :key="acc.id">
                    <span v-if="acc.id === apiKeyBoundAccountId">
                      <span class="font-semibold text-slate-800">{{ acc.name }}</span>
                      <span class="text-slate-400 ml-1 text-xs">{{ accountStatusLabel(acc.status) }}</span>
                      <span class="text-slate-400 ml-1 text-xs">{{ acc.creditBalance ?? '?' }} 积分</span>
                    </span>
                  </template>
                </template>
                <svg class="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <div v-if="showAccountDropdown" class="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl w-72 overflow-hidden">
                <div @click="apiKeyBoundAccountId = ''; showAccountDropdown = false" class="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100">
                  <div>
                    <div class="text-sm font-semibold text-slate-700">不绑定</div>
                    <div class="text-xs text-slate-400">系统自动从账号池分配</div>
                  </div>
                </div>
                <div v-for="acc in accounts" :key="acc.id" @click="apiKeyBoundAccountId = acc.id; showAccountDropdown = false" class="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 cursor-pointer" :class="apiKeyBoundAccountId === acc.id ? 'bg-indigo-50' : ''">
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="accountDotClass(acc.status)"></span>
                  <div>
                    <div class="text-sm font-semibold text-slate-800">{{ acc.name }}</div>
                    <div class="text-xs text-slate-400">{{ acc.creditBalance ?? '?' }} 积分 · {{ accountStatusLabel(acc.status) }}</div>
                  </div>
                  <span v-if="apiKeyBoundAccountId === acc.id" class="ml-auto text-indigo-600 font-bold text-sm">已选</span>
                </div>
              </div>
            </div>
            <button @click="generateApiKey" :disabled="loading" class="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2.5 rounded-lg font-bold text-sm shadow transition">签发令牌</button>
          </div>
          <div v-if="apiKeyResult" class="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
            <p class="text-xs font-bold text-emerald-700 mb-2">新令牌已生成，请立即复制，此处仅显示一次</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 font-mono text-sm text-emerald-800 break-all select-all">{{ apiKeyResult }}</code>
              <button @click="copyKey(apiKeyResult)" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold flex-shrink-0 transition">复制</button>
            </div>
          </div>
        </div>
        <div class="bg-white shadow-sm border border-slate-200 overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 border-b border-slate-200">
              <tr>
                <th class="text-left px-6 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">拥有者</th>
                <th class="text-left px-6 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">API Key</th>
                <th class="text-left px-6 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">绑定账号</th>
                <th class="text-left px-6 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">用量</th>
                <th class="text-left px-6 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">状态</th>
                <th class="text-left px-6 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-if="apikeys.length === 0"><td colspan="6" class="text-center py-12 text-slate-400">暂无令牌，请签发</td></tr>
              <tr v-for="key in apikeys" :key="key.id" class="hover:bg-slate-50 transition">
                <td class="px-6 py-4 font-semibold text-slate-800">{{ key.owner }}</td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <code class="font-mono text-xs text-slate-600 select-all">{{ revealedKeyIds.has(key.id) ? key.key : maskKey(key.key) }}</code>
                    <button @click="toggleRevealKey(key.id)" class="text-slate-500 hover:text-indigo-600 text-xs px-2 py-1 rounded border border-slate-200 transition" :title="revealedKeyIds.has(key.id) ? '隐藏' : '显示明文'">{{ revealedKeyIds.has(key.id) ? '隐藏' : '显示' }}</button>
                    <button @click="copyKey(key.key)" class="text-slate-500 hover:text-indigo-600 text-xs px-2 py-1 rounded border border-slate-200 transition" title="复制">复制</button>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span v-if="key.boundAccount" class="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">{{ key.boundAccount.name }}</span>
                  <span v-else class="text-xs text-slate-400">自动分配</span>
                </td>
                <td class="px-6 py-4 text-slate-500 text-xs">
                  <div class="font-black text-slate-800">{{ key.used || 0 }} / {{ key.quota ?? '∞' }}</div>
                  <div class="mt-1 text-[11px] text-slate-400 whitespace-nowrap">
                    今日 {{ key.usage?.today || 0 }} · 成功 {{ key.usage?.success || 0 }} · 处理中 {{ key.usage?.processing || 0 }} · 失败 {{ key.usage?.failed || 0 }}
                  </div>
                </td>
                <td class="px-6 py-4"><span class="text-xs font-bold px-2 py-1 rounded-full" :class="key.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'">{{ key.isActive ? '启用' : '停用' }}</span></td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <button @click="toggleApiKey(key.id)" class="text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition">{{ key.isActive ? '停用' : '启用' }}</button>
                    <button @click="openRebindModal(key)" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition">改绑</button>
                    <button @click="deleteApiKey(key.id, key.owner)" class="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ========== REBIND MODAL ========== -->
      <div v-if="rebindModal.show" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
        <div class="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-5">
          <div class="flex items-center justify-between">
            <h3 class="font-black text-slate-800 text-lg">修改绑定账号</h3>
            <button @click="rebindModal.show = false" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
          </div>
          <p class="text-sm text-slate-500">令牌拥有者：<span class="font-bold text-slate-700">{{ rebindModal.keyOwner }}</span></p>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-2">选择新的绑定账号</label>
            <select v-model="rebindNewAccountId" class="w-full border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <option value="">不绑定（自动分配公共池）</option>
              <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.name }} · {{ accountStatusLabel(acc.status) }} · {{ acc.creditBalance ?? '?' }} 积分</option>
            </select>
          </div>
          <div class="flex gap-3 justify-end pt-2">
            <button @click="rebindModal.show = false" class="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition">取消</button>
            <button @click="rebindApiKey" class="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow">确认改绑</button>
          </div>
        </div>
      </div>

      <!-- ========== TAB: NATIVE CLI ========== -->
      <div v-if="currentTab === 'native'" class="space-y-6">
        <div class="bg-white shadow-sm border border-slate-200 p-6 space-y-5">
          <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5">
            <div class="max-w-2xl">
              <p class="text-xs font-black text-indigo-600 uppercase tracking-wider">简单模式</p>
              <h2 class="text-2xl font-black text-slate-900 mt-1">即梦原生任务助手</h2>
              <p class="text-sm text-slate-500 mt-2 leading-6">这里不是给你手写命令的地方。选一个账号，点刷新最近任务；拿到 submit_id 后粘到结果查询里，就能看生成结果或下载到服务器。</p>
            </div>
            <div class="w-full xl:w-[420px]">
              <label class="block text-sm font-bold text-slate-700 mb-2">用哪个账号执行</label>
              <select v-model="nativeAccountId" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">请选择账号实例</option>
                <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.name }} · {{ accountStatusLabel(acc.status) }} · {{ acc.creditBalance ?? '?' }} 积分</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p class="text-xs font-bold text-slate-500">当前账号</p>
              <p class="text-sm font-black text-slate-800 mt-1">{{ selectedNativeAccountName() || '还没选择' }}</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p class="text-xs font-bold text-slate-500">推荐动作</p>
              <p class="text-sm font-black text-slate-800 mt-1">先点“刷新最近任务”</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p class="text-xs font-bold text-slate-500">高级命令</p>
              <p class="text-sm font-black text-slate-800 mt-1">会话管理已折叠</p>
            </div>
          </div>
          <div v-if="nativeError" class="mt-4 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">{{ nativeError }}</div>
        </div>

        <div class="grid grid-cols-1 2xl:grid-cols-[1.05fr_.95fr] gap-6">
          <div class="bg-white shadow-sm border border-slate-200 p-6 space-y-5">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h3 class="font-black text-slate-900">1. 刷新最近任务</h3>
                <p class="text-xs text-slate-400 mt-1">不用记 CLI 参数。默认查最近 20 条，必要时再筛选类型或状态。</p>
              </div>
              <button @click="fetchNativeTasks" :disabled="nativeLoading === 'tasks'" class="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-black">{{ nativeLoading === 'tasks' ? '查询中...' : '刷新最近任务' }}</button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <select v-model="nativeTaskStatus" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option v-for="item in nativeQuickStatusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
              <select v-model="nativeTaskType" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option v-for="item in nativeQuickTaskTypeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
              <input v-model.trim="nativeTaskSubmitId" class="md:col-span-2 border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="有 submit_id 时可直接筛选" />
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <label class="text-xs font-bold text-slate-500">每次显示</label>
              <input v-model.number="nativeTaskLimit" type="number" min="1" max="100" class="w-24 border border-slate-300 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <label class="text-xs font-bold text-slate-500">跳过</label>
              <input v-model.number="nativeTaskOffset" type="number" min="0" class="w-24 border border-slate-300 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            <div v-if="nativeTasksResult" class="rounded-xl border border-slate-200 overflow-hidden">
              <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-black text-slate-800">查询结果</p>
                  <p class="text-xs text-slate-400 mt-1">{{ nativeTaskItems(nativeTasksResult).length ? `解析到 ${nativeTaskItems(nativeTasksResult).length} 条任务` : '没有解析到结构化任务，保留原始输出' }}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button @click="nativeShowTaskRaw = !nativeShowTaskRaw" class="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg">{{ nativeShowTaskRaw ? '收起原始结果' : '展开原始结果' }}</button>
                  <button @click="nativeCopy(nativeResultText(nativeTasksResult))" class="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg">复制全部</button>
                </div>
              </div>
              <div v-if="nativeTaskItems(nativeTasksResult).length" class="divide-y divide-slate-100 bg-white">
                <div v-for="task in nativeTaskItems(nativeTasksResult)" :key="task.submitId || JSON.stringify(task.raw).slice(0, 80)" class="p-4 space-y-3">
                  <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-black px-2.5 py-1 rounded-full border" :class="nativeTaskStatusClass(task.status)">{{ nativeTaskStatusLabel(task.status) }}</span>
                        <span v-if="task.taskType" class="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{{ task.taskType }}</span>
                      </div>
                      <p class="font-mono text-xs text-slate-900 mt-2 break-all">{{ task.submitId || '缺少 submit_id' }}</p>
                      <p v-if="task.prompt" class="text-sm text-slate-500 mt-2 line-clamp-2 break-words">{{ task.prompt }}</p>
                    </div>
                    <div class="flex flex-wrap gap-2 shrink-0">
                      <button @click="nativeCopy(task.submitId)" :disabled="!task.submitId" class="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 px-3 py-1.5 rounded-lg">复制 ID</button>
                      <button @click="useNativeSubmitId(task.submitId)" :disabled="!task.submitId" class="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 px-3 py-1.5 rounded-lg">填入查询</button>
                      <button @click="queryNativeSubmitId(task.submitId)" :disabled="!task.submitId || nativeLoading === 'query'" class="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 px-3 py-1.5 rounded-lg">直接查询</button>
                    </div>
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-500">
                    <div v-if="task.createdAt" class="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">创建：{{ task.createdAt }}</div>
                    <div v-if="task.updatedAt" class="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">更新：{{ task.updatedAt }}</div>
                  </div>
                </div>
              </div>
              <div v-else class="p-4 text-sm text-slate-500 bg-white">这次 CLI 返回里没有可识别的任务数组，可以展开原始结果检查字段。</div>
              <pre v-if="nativeShowTaskRaw" class="bg-slate-950 text-slate-200 p-4 text-xs font-mono max-h-[360px] overflow-auto whitespace-pre-wrap">{{ nativeResultText(nativeTasksResult) }}</pre>
            </div>
            <div v-else class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">点击“刷新最近任务”后，这里会显示 CLI 返回的任务列表。看到 submit_id 后可以复制到右侧查询最终结果。</div>
          </div>

          <div class="bg-white shadow-sm border border-slate-200 p-6 space-y-5">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h3 class="font-black text-slate-900">2. 查询一个结果</h3>
                <p class="text-xs text-slate-400 mt-1">把任务里的 submit_id 粘进来。勾选下载后，结果保存到服务端 data/downloads 子目录。</p>
              </div>
              <button @click="queryNativeResult" :disabled="nativeLoading === 'query'" class="bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-black">{{ nativeLoading === 'query' ? '查询中...' : '查询结果' }}</button>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-[1fr_auto_220px] gap-3 items-center">
              <input v-model.trim="nativeQuerySubmitId" class="border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="粘贴 submit_id" />
              <label class="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl">
                <input v-model="nativeQueryDownload" type="checkbox" class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                下载结果
              </label>
              <input v-model.trim="nativeQueryDownloadDirName" :disabled="!nativeQueryDownload" class="border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50" placeholder="目录名，可不填" />
            </div>

            <div v-if="nativeResultSummary(nativeQueryResult)" class="rounded-xl border border-slate-200 overflow-hidden">
              <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-black text-slate-800">最终结果</p>
                  <p class="text-xs text-slate-400 mt-1">{{ nativeResultSummary(nativeQueryResult)?.status ? `官方状态：${nativeTaskStatusLabel(nativeResultSummary(nativeQueryResult)?.status || '')}` : '默认显示可操作字段，原始输出按需展开' }}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button v-if="nativeResultSummary(nativeQueryResult)?.url" @click="nativeCopy(nativeResultSummary(nativeQueryResult)?.url || '')" class="text-xs font-bold text-indigo-600 bg-white border border-indigo-100 px-3 py-1.5 rounded-lg">复制链接</button>
                  <a v-if="nativeResultSummary(nativeQueryResult)?.url" :href="nativeResultSummary(nativeQueryResult)?.url" target="_blank" class="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg">打开结果</a>
                  <button @click="nativeShowQueryRaw = !nativeShowQueryRaw" class="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg">{{ nativeShowQueryRaw ? '收起原始结果' : '展开原始结果' }}</button>
                  <button @click="nativeCopy(nativeResultText(nativeQueryResult))" class="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg">复制全部</button>
                </div>
              </div>
              <div class="p-4 space-y-4 bg-white">
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  <div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
                    <p class="text-xs font-bold text-slate-500">submit_id</p>
                    <p class="text-sm font-black text-slate-900 mt-1 break-all">{{ nativeResultSummary(nativeQueryResult)?.submitId || nativeQuerySubmitId || '-' }}</p>
                  </div>
                  <div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
                    <p class="text-xs font-bold text-slate-500">状态</p>
                    <p class="text-sm font-black text-slate-900 mt-1">{{ nativeTaskStatusLabel(nativeResultSummary(nativeQueryResult)?.status || '') }}</p>
                  </div>
                  <div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
                    <p class="text-xs font-bold text-slate-500">消耗/排队</p>
                    <p class="text-sm font-black text-slate-900 mt-1 break-words">{{ nativeResultSummary(nativeQueryResult)?.credit || nativeResultSummary(nativeQueryResult)?.queue || '-' }}</p>
                  </div>
                  <div v-if="nativeResultSummary(nativeQueryResult)?.taskType" class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
                    <p class="text-xs font-bold text-slate-500">类型</p>
                    <p class="text-sm font-black text-slate-900 mt-1 break-words">{{ nativeResultSummary(nativeQueryResult)?.taskType }}</p>
                  </div>
                  <div v-if="nativeResultSummary(nativeQueryResult)?.downloadDir" class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
                    <p class="text-xs font-bold text-slate-500">下载目录</p>
                    <p class="text-sm font-black text-slate-900 mt-1 break-all">{{ nativeResultSummary(nativeQueryResult)?.downloadDir }}</p>
                  </div>
                  <div v-if="nativeResultSummary(nativeQueryResult)?.localPath" class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
                    <p class="text-xs font-bold text-slate-500">本地文件</p>
                    <p class="text-sm font-black text-slate-900 mt-1 break-all">{{ nativeResultSummary(nativeQueryResult)?.localPath }}</p>
                  </div>
                </div>
                <div v-if="nativeResultSummary(nativeQueryResult)?.urls.length" class="rounded-xl border border-emerald-100 bg-emerald-50 overflow-hidden">
                  <div class="px-4 py-3 border-b border-emerald-100 flex items-center justify-between">
                    <p class="text-sm font-black text-emerald-900">结果链接</p>
                    <span class="text-xs font-bold text-emerald-700">{{ nativeResultSummary(nativeQueryResult)?.urls.length }} 个</span>
                  </div>
                  <div class="divide-y divide-emerald-100">
                    <div v-for="url in nativeResultSummary(nativeQueryResult)?.urls" :key="url" class="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <p class="text-xs text-emerald-800 break-all font-mono">{{ url }}</p>
                      <div class="flex gap-2 shrink-0">
                        <button @click="nativeCopy(url)" class="text-xs font-bold text-emerald-700 bg-white border border-emerald-100 px-3 py-1.5 rounded-lg">复制</button>
                        <a :href="url" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-emerald-700 bg-white border border-emerald-100 px-3 py-1.5 rounded-lg">打开</a>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">暂时没有解析到结果链接；如果状态仍在排队或生成中，可以稍后再次查询。</div>
              </div>
              <pre v-if="nativeShowQueryRaw" class="bg-slate-950 text-slate-200 p-4 text-xs font-mono max-h-[360px] overflow-auto whitespace-pre-wrap">{{ nativeResultText(nativeQueryResult) }}</pre>
            </div>
            <div v-else class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">这里会显示 query_result 的最终链接、下载目录和原始返回。没有 submit_id 时先刷新左侧最近任务。</div>
          </div>
        </div>

        <div class="bg-white shadow-sm border border-slate-200 p-6 space-y-5">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h3 class="font-black text-slate-900">高级：会话管理</h3>
              <p class="text-xs text-slate-400 mt-1">一般不用动。只有需要隔离历史、重命名会话或清理会话时再打开。</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button @click="fetchNativeSessions" :disabled="nativeLoading === 'sessions'" class="bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-700 px-4 py-2 rounded-lg font-bold text-sm">刷新会话</button>
              <button @click="nativeShowAdvancedSessions = !nativeShowAdvancedSessions" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm">{{ nativeShowAdvancedSessions ? '收起' : '展开高级操作' }}</button>
            </div>
          </div>

          <div v-if="nativeShowAdvancedSessions" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
              <input v-model.number="nativeSessionMaxCount" type="number" min="1" max="100" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="列表数量" />
              <div class="flex gap-3">
                <input v-model.trim="nativeSessionName" class="flex-1 border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="新会话名称，可留空自动命名" />
                <button @click="createNativeSession" :disabled="nativeLoading === 'session-create'" class="bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-bold">创建</button>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <input v-model.trim="nativeSessionSearchName" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="按会话名搜索" />
              <button @click="searchNativeSession" :disabled="nativeLoading === 'session-search'" class="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-bold">搜索</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-[130px_1fr_auto_auto] gap-3">
              <input v-model.trim="nativeSessionId" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="会话 ID" />
              <input v-model.trim="nativeSessionNewName" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="新名称" />
              <button @click="renameNativeSession" :disabled="nativeLoading === 'session-rename'" class="bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-700 px-4 py-2.5 rounded-lg text-sm font-bold">重命名</button>
              <button @click="deleteNativeSession" :disabled="nativeLoading === 'session-delete'" class="bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 px-4 py-2.5 rounded-lg text-sm font-bold">删除</button>
            </div>
          </div>

          <div v-if="nativeSessionsResult" class="rounded-xl border border-slate-200 overflow-hidden">
            <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-sm font-black text-slate-800">会话结果</p>
                <p class="text-xs text-slate-400 mt-1">{{ nativeSessionItems(nativeSessionsResult).length ? `解析到 ${nativeSessionItems(nativeSessionsResult).length} 个会话` : '没有解析到结构化会话，保留原始输出' }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button @click="nativeShowSessionRaw = !nativeShowSessionRaw" class="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg">{{ nativeShowSessionRaw ? '收起原始结果' : '展开原始结果' }}</button>
                <button @click="nativeCopy(nativeResultText(nativeSessionsResult))" class="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg">复制全部</button>
              </div>
            </div>
            <div v-if="nativeSessionItems(nativeSessionsResult).length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4 bg-white">
              <div v-for="session in nativeSessionItems(nativeSessionsResult)" :key="session.id || session.name" class="rounded-xl border border-slate-100 bg-slate-50 p-4 min-w-0">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-xs font-bold text-slate-500">会话 ID</p>
                    <p class="font-mono text-sm font-black text-slate-900 mt-1 break-all">{{ session.id || '-' }}</p>
                    <p class="text-sm text-slate-600 mt-2 truncate">{{ session.name || '未命名会话' }}</p>
                  </div>
                  <button @click="useNativeSession(session)" :disabled="!session.id" class="text-xs font-bold text-indigo-600 bg-white border border-indigo-100 px-3 py-1.5 rounded-lg disabled:opacity-40 shrink-0">填入</button>
                </div>
                <p v-if="session.updatedAt || session.status" class="text-xs text-slate-400 mt-3 break-words">{{ session.status || '' }} {{ session.updatedAt || '' }}</p>
              </div>
            </div>
            <div v-else class="p-4 text-sm text-slate-500 bg-white">这次 CLI 返回里没有可识别的会话列表，可以展开原始结果检查字段。</div>
            <pre v-if="nativeShowSessionRaw" class="bg-slate-950 text-slate-200 p-4 text-xs font-mono max-h-[320px] overflow-auto whitespace-pre-wrap">{{ nativeResultText(nativeSessionsResult) }}</pre>
          </div>
        </div>
      </div>

      <!-- ========== TAB: SDK TEST ========== -->
      <div v-if="currentTab === 'sdkTest'" class="space-y-6">
        <div class="bg-white border border-slate-200 shadow-sm p-6">
          <div class="grid grid-cols-1 2xl:grid-cols-[1fr_360px] gap-6">
            <div class="space-y-5">
              <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                <div>
                  <p class="text-xs font-black text-indigo-600 uppercase tracking-wider">OpenAI SDK Test</p>
                  <h3 class="text-2xl font-black text-slate-900 mt-1">接口测试台</h3>
                  <p class="text-sm text-slate-500 mt-2 leading-6">这里直接调用当前服务的 <code class="bg-slate-100 px-1 rounded font-mono">/v1</code> 接口。生成类请求会消耗账号额度，建议先用“模型列表”验证 Key。</p>
                </div>
                <div class="flex flex-wrap gap-2 w-full xl:w-auto">
                  <button @click="runSdkTest" :disabled="sdkLoading" class="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-black">{{ sdkLoading ? '请求中...' : '发送测试请求' }}</button>
                  <button @click="pollSdkResult" :disabled="sdkPolling || !pollPathForSdkResponse(sdkResponse)" class="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-black">{{ sdkPolling ? '轮询中...' : '轮询结果' }}</button>
                </div>
              </div>

              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-bold text-slate-700 mb-2">测试模式</label>
                  <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                    <button
                      v-for="mode in primarySdkModeOptions()"
                      :key="mode.value"
                      @click="selectSdkMode(mode.value)"
                      class="text-left border px-4 py-3 rounded-xl transition min-h-[92px]"
                      :class="sdkMode === mode.value ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <p class="text-sm font-black text-slate-900">{{ mode.label }}</p>
                        <span class="text-[11px] font-black px-2 py-0.5 rounded-full" :class="mode.value === 'models' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'">{{ mode.cost }}</span>
                      </div>
                      <p class="font-mono text-[11px] text-slate-400 mt-2 break-all">{{ mode.endpoint }}</p>
                      <p class="text-xs text-slate-500 mt-2 leading-5">{{ mode.hint }}</p>
                    </button>
                  </div>
                  <div class="mt-3">
                    <button @click="sdkShowLegacyModes = !sdkShowLegacyModes" class="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">{{ sdkShowLegacyModes ? '收起兼容旧接口' : '兼容旧接口' }}</button>
                    <div v-if="sdkShowLegacyModes" class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                      <button
                        v-for="mode in legacySdkModeOptions()"
                        :key="mode.value"
                        @click="selectSdkMode(mode.value)"
                        class="text-left border px-4 py-3 rounded-xl transition"
                        :class="sdkMode === mode.value ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'"
                      >
                        <div class="flex items-start justify-between gap-3">
                          <p class="text-sm font-black text-slate-900">{{ mode.label }}</p>
                          <span class="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{{ mode.cost }}</span>
                        </div>
                        <p class="font-mono text-[11px] text-slate-400 mt-2 break-all">{{ mode.endpoint }}</p>
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-bold text-slate-700 mb-2">测试 API Key</label>
                  <div class="grid grid-cols-1 xl:grid-cols-[240px_1fr_auto] gap-3">
                    <select v-model="sdkSelectedKeyId" class="border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                      <option value="">从已签发 Key 选择</option>
                      <option v-for="key in apikeys" :key="key.id" :value="key.id">{{ key.owner }} · {{ key.isActive ? '启用' : '停用' }}{{ key.boundAccount ? ' · ' + key.boundAccount.name : '' }}</option>
                    </select>
                    <input v-model.trim="sdkApiKey" type="password" class="border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="粘贴完整 sk-jm-...；脱敏 Key 不能测试" />
                    <div class="flex gap-2">
                      <button @click="useSelectedSdkKey" class="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-3 rounded-xl text-sm font-bold">使用所选</button>
                      <button @click="saveSdkApiKey" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-3 rounded-xl text-sm font-bold">保存</button>
                    </div>
                  </div>
                  <p class="text-xs text-slate-400 mt-2">如果列表里的 Key 已脱敏，只能用于识别，不能直接发送请求。新签发后立即复制到这里即可测试。</p>
                </div>
              </div>

              <div v-if="sdkMode !== 'models'" class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div class="xl:col-span-2">
                  <label class="block text-sm font-bold text-slate-700 mb-2">Prompt / input</label>
                  <textarea v-model="sdkPrompt" rows="4" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white resize-y leading-6"></textarea>
                </div>
                <div v-if="sdkMode === 'responses-image' || sdkMode === 'legacy-image'">
                  <label class="block text-sm font-bold text-slate-700 mb-2">图片模型</label>
                  <select v-model="sdkImageModel" @change="syncSdkImageResolution" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                    <option v-for="model in sdkModelOptions.image" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
                <div v-if="sdkMode !== 'responses-image' && sdkMode !== 'legacy-image'">
                  <label class="block text-sm font-bold text-slate-700 mb-2">视频模型</label>
                  <select v-model="sdkVideoModel" @change="syncSdkVideoOptions" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                    <option v-for="model in sdkModelOptions.video" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                  <p class="text-xs text-slate-400 mt-2">同一个视频模型支持多个功能，具体功能由模式决定。</p>
                </div>
                <div>
                  <label class="block text-sm font-bold text-slate-700 mb-2">比例</label>
                  <select v-model="sdkRatio" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                    <option value="4:3">4:3</option>
                    <option value="3:4">3:4</option>
                    <option value="21:9">21:9</option>
                  </select>
                </div>
                <div v-if="sdkMode === 'responses-image' || sdkMode === 'legacy-image'">
                  <label class="block text-sm font-bold text-slate-700 mb-2">图片清晰度</label>
                  <select v-model="sdkResolution" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                    <option v-for="item in sdkImageResolutionOptions()" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                  <p class="text-xs text-slate-400 mt-2">{{ sdkImageModelVersion() === '3.0' || sdkImageModelVersion() === '3.1' ? '3.x 图片模型最高支持 2k。' : '当前模型支持 2k / 4k。' }}</p>
                </div>
                <div v-if="sdkMode === 'videos-create'">
                  <label class="block text-sm font-bold text-slate-700 mb-2">SDK size</label>
                  <select v-model="sdkVideoSize" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                    <option value="1280x720">1280x720</option>
                    <option value="720x1280">720x1280</option>
                  </select>
                </div>
                <div v-if="sdkMode !== 'responses-image' && sdkMode !== 'legacy-image'">
                  <label class="block text-sm font-bold text-slate-700 mb-2">视频秒数</label>
                  <input v-model.number="sdkVideoSeconds" @change="syncSdkVideoOptions" type="number" :min="sdkVideoDurationRange().min" :max="sdkVideoDurationRange().max" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                  <p class="text-xs text-slate-400 mt-2">当前可用范围：{{ sdkVideoDurationRange().min }}-{{ sdkVideoDurationRange().max }} 秒</p>
                </div>
                <div class="xl:col-span-2">
                  <button @click="sdkShowAdvancedParams = !sdkShowAdvancedParams" class="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">{{ sdkShowAdvancedParams ? '收起高级参数' : '高级参数' }}</button>
                  <div v-if="sdkShowAdvancedParams" class="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div v-if="sdkMode !== 'responses-image' && sdkMode !== 'legacy-image'">
                      <label class="block text-sm font-bold text-slate-700 mb-2">功能模式</label>
                      <select v-model="sdkVideoMode" @change="syncSdkVideoOptions" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                        <option v-for="mode in sdkVideoModeOptions" :key="mode.value" :value="mode.value">{{ mode.label }}</option>
                      </select>
                      <p class="text-xs text-slate-400 mt-2">默认自动判断；多图、多关键帧或首尾帧时再调整。</p>
                    </div>
                    <div v-if="sdkMode !== 'responses-image' && sdkMode !== 'legacy-image'">
                      <label class="block text-sm font-bold text-slate-700 mb-2">视频清晰度</label>
                      <select v-model="sdkVideoResolution" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                        <option v-for="item in sdkVideoResolutionOptions()" :key="item.value" :value="item.value">{{ item.label }}</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-bold text-slate-700 mb-2">CLI session</label>
                      <input v-model.trim="sdkSession" type="number" min="0" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="可选，不填走默认会话" />
                    </div>
                    <div class="xl:col-span-2">
                      <label class="block text-sm font-bold text-slate-700 mb-2">额外 metadata JSON</label>
                      <textarea v-model="sdkMetadataJson" rows="4" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white font-mono resize-y" placeholder='例如 {"operation":"image_upscale"}'></textarea>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="sdkError" class="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">{{ sdkError }}</div>
            </div>

            <div class="space-y-4">
              <div class="bg-slate-950 text-white p-5">
                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">当前请求</p>
                <p class="text-xl font-black mt-2">{{ sdkModeLabel() }}</p>
                <p class="text-xs text-slate-400 mt-2 font-mono">{{ sdkEndpoint().method }} {{ sdkEndpoint().path }}</p>
                <div class="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div class="bg-white/10 p-3 rounded-lg">
                    <p class="text-slate-400">Key</p>
                    <p class="font-black mt-1">{{ activeSdkApiKey() ? '已配置' : '未配置' }}</p>
                  </div>
                  <div class="bg-white/10 p-3 rounded-lg">
                    <p class="text-slate-400">下一步</p>
                    <p class="font-black mt-1">{{ sdkNextActionLabel() }}</p>
                  </div>
                </div>
                <div class="mt-3 bg-white/10 p-3 rounded-lg text-xs min-w-0">
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-slate-400">CLI 状态</p>
                    <span class="font-mono text-slate-300">{{ sdkProgressElapsedLabel() }}</span>
                  </div>
                  <p class="font-black mt-1">{{ sdkProgressLabel(sdkSubmitProgress?.phase || 'idle') }}</p>
                  <p v-if="sdkProgressDetailLabel()" class="text-slate-400 mt-1 leading-5">{{ sdkProgressDetailLabel() }}</p>
                  <div v-if="sdkSubmitProgress?.accountName || sdkSubmitProgress?.taskId || sdkSubmitProgress?.submitId" class="mt-2 space-y-1 text-slate-300">
                    <p v-if="sdkSubmitProgress?.accountName">账号：{{ sdkSubmitProgress.accountName }}</p>
                    <p v-if="sdkSubmitProgress?.taskId" class="break-all">任务：{{ sdkSubmitProgress.taskId }}</p>
                    <p v-if="sdkSubmitProgress?.submitId" class="break-all">submit_id：{{ sdkSubmitProgress.submitId }}</p>
                  </div>
                  <p v-if="sdkSubmitProgress?.errorType" class="text-red-100 mt-2">归因：{{ sdkErrorTypeLabel(sdkSubmitProgress.errorType) }}<span v-if="sdkSubmitProgress?.errorCode" class="font-mono"> / {{ sdkSubmitProgress.errorCode }}</span></p>
                  <p v-if="sdkSubmitProgress?.error" class="text-red-200 mt-2 break-words">{{ sdkSubmitProgress.error }}</p>
                </div>
                <div v-if="extractTaskIdFromSdkResponse(sdkResponse)" class="mt-2 bg-white/10 p-3 rounded-lg text-xs min-w-0">
                  <p class="text-slate-400">任务 ID</p>
                  <p class="font-mono font-black mt-1 break-all">{{ extractTaskIdFromSdkResponse(sdkResponse) }}</p>
                </div>
                <div v-if="pollPathForSdkResponse(sdkResponse)" class="mt-2 bg-white/10 p-3 rounded-lg text-xs min-w-0">
                  <p class="text-slate-400">轮询地址</p>
                  <p class="font-mono font-black mt-1 break-all">{{ pollPathForSdkResponse(sdkResponse) }}</p>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                  <button @click="sdkShowRequestPreview = !sdkShowRequestPreview" class="text-xs font-bold text-slate-900 bg-white/90 hover:bg-white px-3 py-1.5 rounded-lg">{{ sdkShowRequestPreview ? '收起请求' : '展开请求 JSON' }}</button>
                  <button @click="nativeCopy(jsonText(sdkRequestPreview()))" class="text-xs font-bold text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg">复制请求</button>
                </div>
                <pre v-if="sdkShowRequestPreview" class="mt-3 bg-black/40 text-slate-200 rounded-xl p-4 text-xs font-mono max-h-[260px] overflow-auto whitespace-pre-wrap">{{ jsonText(sdkRequestPreview()) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 2xl:grid-cols-2 gap-6">
          <div class="bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="font-black text-slate-900">提交响应</h3>
                <p class="text-xs text-slate-400 mt-1">默认显示摘要，完整 JSON 可按需展开</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <a v-if="sdkTaskPreviewUrl(sdkResponse)" :href="sdkTaskPreviewUrl(sdkResponse)" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg">打开预览</a>
                <button v-if="extractTaskIdFromSdkResponse(sdkResponse)" @click="openSdkTaskInAdmin" class="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg">去任务页</button>
                <button @click="sdkShowRawResponse = !sdkShowRawResponse" :disabled="!sdkResponse" class="text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 px-3 py-1.5 rounded-lg">{{ sdkShowRawResponse ? '收起 JSON' : '展开 JSON' }}</button>
                <button @click="clearSdkResult" :disabled="!sdkResponse && !sdkPollResponse && !sdkError" class="text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 px-3 py-1.5 rounded-lg">清空</button>
                <button @click="nativeCopy(jsonText(sdkResponse))" :disabled="!sdkResponse" class="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 px-3 py-1.5 rounded-lg">复制</button>
              </div>
            </div>
            <div v-if="sdkResponse" class="p-5 space-y-4">
              <div v-if="sdkResponseSummary(sdkResponse)" class="space-y-4">
                <div>
                  <h4 class="text-lg font-black text-slate-900">{{ sdkResponseSummary(sdkResponse)?.title }}</h4>
                  <p class="text-sm text-slate-500 mt-1">{{ sdkResponseSummary(sdkResponse)?.subtitle }}</p>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div v-for="item in sdkResponseSummary(sdkResponse)?.stats" :key="item.label" class="bg-slate-50 border border-slate-100 rounded-xl p-4 min-w-0">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">{{ item.label }}</p>
                    <p class="text-sm font-black text-slate-900 mt-2 break-words">{{ item.value }}</p>
                  </div>
                </div>
                <div v-if="sdkResponseSummary(sdkResponse)?.groups.length" class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div v-for="group in sdkResponseSummary(sdkResponse)?.groups" :key="group.label" class="space-y-2">
                    <p class="text-xs font-black text-slate-500 uppercase tracking-wider">{{ group.label }}</p>
                    <div class="flex flex-wrap gap-2">
                      <span v-for="item in group.items" :key="`${group.label}-${item}`" class="text-xs font-bold px-2.5 py-1 rounded-full border" :class="group.label === '模型版本' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-indigo-700 bg-indigo-50 border-indigo-100'">{{ item }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="sdkMediaPreview(sdkResponse).length" class="border border-slate-200 rounded-xl overflow-hidden">
                <div class="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <p class="text-sm font-black text-slate-800">结果预览</p>
                  <span class="text-xs font-bold text-slate-400">{{ sdkMediaPreview(sdkResponse).length }} 个文件</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                  <div v-for="media in sdkMediaPreview(sdkResponse)" :key="media.url" class="border border-slate-100 rounded-xl overflow-hidden bg-slate-50">
                    <img v-if="media.kind === 'image'" :src="sdkMediaDisplayUrl(sdkResponse, media)" class="w-full max-h-[360px] object-contain bg-slate-950" loading="lazy" />
                    <video v-else-if="media.kind === 'video'" :src="sdkMediaDisplayUrl(sdkResponse, media)" controls class="w-full max-h-[360px] bg-slate-950"></video>
                    <div v-else class="p-5 text-sm text-slate-600">暂不支持内嵌预览，可打开链接查看。</div>
                    <div class="p-3 border-t border-slate-100 bg-white flex items-center justify-between gap-3">
                      <span class="text-xs font-bold text-slate-500 uppercase">{{ media.kind }}</span>
                      <a :href="sdkMediaDisplayUrl(sdkResponse, media)" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-emerald-700 hover:text-emerald-800 truncate">打开预览</a>
                      <a v-if="sdkMediaDisplayUrl(sdkResponse, media) !== media.url" :href="media.url" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-slate-500 hover:text-slate-700 truncate">原始链接</a>
                    </div>
                  </div>
                </div>
              </div>
              <pre v-if="sdkShowRawResponse" class="bg-slate-950 text-slate-200 rounded-xl p-5 text-xs font-mono max-h-[420px] overflow-auto whitespace-pre-wrap">{{ jsonText(sdkResponse) }}</pre>
            </div>
            <div v-else class="p-5 text-sm text-slate-500 min-h-[180px] flex items-center">还没有响应。先点击“发送测试请求”。</div>
          </div>

          <div class="bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="font-black text-slate-900">轮询响应</h3>
                <p class="text-xs text-slate-400 mt-1">{{ pollPathForSdkResponse(sdkResponse) || '提交成功后显示轮询地址' }}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <a v-if="sdkTaskPreviewUrl(sdkPollResponse || sdkResponse)" :href="sdkTaskPreviewUrl(sdkPollResponse || sdkResponse)" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg">打开预览</a>
                <button @click="sdkShowRawPollResponse = !sdkShowRawPollResponse" :disabled="!sdkPollResponse" class="text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 px-3 py-1.5 rounded-lg">{{ sdkShowRawPollResponse ? '收起 JSON' : '展开 JSON' }}</button>
                <button @click="nativeCopy(jsonText(sdkPollResponse))" :disabled="!sdkPollResponse" class="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 px-3 py-1.5 rounded-lg">复制</button>
              </div>
            </div>
            <div v-if="sdkPollResponse" class="p-5 space-y-4">
              <div v-if="sdkResponseSummary(sdkPollResponse)" class="space-y-4">
                <div>
                  <h4 class="text-lg font-black text-slate-900">{{ sdkResponseSummary(sdkPollResponse)?.title }}</h4>
                  <p class="text-sm text-slate-500 mt-1">{{ sdkResponseSummary(sdkPollResponse)?.subtitle }}</p>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div v-for="item in sdkResponseSummary(sdkPollResponse)?.stats" :key="item.label" class="bg-slate-50 border border-slate-100 rounded-xl p-4 min-w-0">
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">{{ item.label }}</p>
                    <p class="text-sm font-black text-slate-900 mt-2 break-words">{{ item.value }}</p>
                  </div>
                </div>
                <div v-if="sdkResponseSummary(sdkPollResponse)?.groups.length" class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div v-for="group in sdkResponseSummary(sdkPollResponse)?.groups" :key="group.label" class="space-y-2">
                    <p class="text-xs font-black text-slate-500 uppercase tracking-wider">{{ group.label }}</p>
                    <div class="flex flex-wrap gap-2">
                      <span v-for="item in group.items" :key="`${group.label}-${item}`" class="text-xs font-bold px-2.5 py-1 rounded-full border" :class="group.label === '模型版本' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-indigo-700 bg-indigo-50 border-indigo-100'">{{ item }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="sdkMediaPreview(sdkPollResponse, sdkResponse).length" class="border border-slate-200 rounded-xl overflow-hidden">
                <div class="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <p class="text-sm font-black text-slate-800">结果预览</p>
                  <span class="text-xs font-bold text-slate-400">{{ sdkMediaPreview(sdkPollResponse, sdkResponse).length }} 个文件</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                  <div v-for="media in sdkMediaPreview(sdkPollResponse, sdkResponse)" :key="media.url" class="border border-slate-100 rounded-xl overflow-hidden bg-slate-50">
                    <img v-if="media.kind === 'image'" :src="sdkMediaDisplayUrl(sdkPollResponse || sdkResponse, media)" class="w-full max-h-[360px] object-contain bg-slate-950" loading="lazy" />
                    <video v-else-if="media.kind === 'video'" :src="sdkMediaDisplayUrl(sdkPollResponse || sdkResponse, media)" controls class="w-full max-h-[360px] bg-slate-950"></video>
                    <div v-else class="p-5 text-sm text-slate-600">暂不支持内嵌预览，可打开链接查看。</div>
                    <div class="p-3 border-t border-slate-100 bg-white flex items-center justify-between gap-3">
                      <span class="text-xs font-bold text-slate-500 uppercase">{{ media.kind }}</span>
                      <a :href="sdkMediaDisplayUrl(sdkPollResponse || sdkResponse, media)" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-emerald-700 hover:text-emerald-800 truncate">打开预览</a>
                      <a v-if="sdkMediaDisplayUrl(sdkPollResponse || sdkResponse, media) !== media.url" :href="media.url" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-slate-500 hover:text-slate-700 truncate">原始链接</a>
                    </div>
                  </div>
                </div>
              </div>
              <pre v-if="sdkShowRawPollResponse" class="bg-slate-950 text-slate-200 rounded-xl p-5 text-xs font-mono max-h-[420px] overflow-auto whitespace-pre-wrap">{{ jsonText(sdkPollResponse) }}</pre>
            </div>
            <div v-else class="p-5 text-sm text-slate-500 min-h-[180px] flex items-center">提交后点击“轮询结果”，查看任务是否 success / failed。</div>
          </div>
        </div>
      </div>

      <!-- ========== TAB: DOCS ========== -->
      <ApiDocs v-if="currentTab === 'docs'" />

      <!-- ========== TAB: PROMPT RISK ========== -->
      <div v-if="currentTab === 'risk'" class="space-y-5">
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px] gap-5">
          <div class="space-y-5 min-w-0">
            <div class="bg-white rounded-lg shadow-sm border border-slate-200 p-4 sm:p-5">
              <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-4">
                <div>
                  <p class="text-sm font-black text-slate-900">提交前失败预检</p>
                  <p class="text-sm text-slate-500 mt-1">按历史失败任务相似度、失败原因和筛选条件判断风险。</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span class="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">不消耗积分</span>
                  <span v-if="riskResult?.checkedAt" class="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">{{ new Date(riskResult.checkedAt).toLocaleTimeString() }}</span>
                </div>
              </div>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-bold text-slate-700 mb-2">待检查提示词</label>
                  <textarea v-model="riskPrompt" rows="6" placeholder="粘贴即将提交到生图或生视频接口的提示词" class="w-full border border-slate-300 bg-slate-50 focus:bg-white px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-y leading-6"></textarea>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[220px_220px_minmax(0,1fr)] gap-3 items-end">
                  <div>
                    <label class="block text-sm font-bold text-slate-700 mb-2">模型筛选</label>
                    <input v-model="riskModel" placeholder="可选，如 5.0" class="w-full border border-slate-300 px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                  </div>
                  <div>
                    <label class="block text-sm font-bold text-slate-700 mb-2">任务类型</label>
                    <select v-model="riskType" class="w-full border border-slate-300 px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                      <option value="">全部类型</option>
                      <option value="text2image">text2image</option>
                      <option value="image2image">image2image</option>
                      <option value="image_upscale">image_upscale</option>
                      <option value="text2video">text2video</option>
                      <option value="image2video">image2video</option>
                      <option value="frames2video">frames2video</option>
                      <option value="multiframe2video">multiframe2video</option>
                      <option value="multimodal2video">multimodal2video</option>
                    </select>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-2 sm:col-span-2 xl:col-span-1">
                    <button @click="checkPromptRisk" :disabled="riskLoading" class="w-full sm:w-auto bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-black text-sm shadow-sm transition">{{ riskLoading ? '检查中...' : '开始预检' }}</button>
                    <button @click="clearPromptRisk" class="w-full sm:w-auto bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-5 py-3 rounded-lg font-bold text-sm">清空</button>
                  </div>
                </div>
                <div v-if="riskError" class="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">{{ riskError }}</div>
              </div>
            </div>

            <div v-if="riskResult" class="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              <div class="grid grid-cols-2 lg:grid-cols-4 divide-x-0 lg:divide-x divide-y lg:divide-y-0 divide-slate-100">
                <div class="p-4">
                  <p class="text-xs font-bold text-slate-400">风险级别</p>
                  <p class="mt-2 inline-flex border px-3 py-1.5 rounded-lg text-xs font-black" :class="riskLevelClass(riskResult.level)">{{ riskLevelLabel(riskResult.level) }}</p>
                </div>
                <div class="p-4">
                  <p class="text-xs font-bold text-slate-400">最高相似度</p>
                  <p class="text-2xl font-black text-slate-900 mt-1">{{ riskScorePercent(riskResult.highestSimilarity || 0) }}</p>
                </div>
                <div class="p-4">
                  <p class="text-xs font-bold text-slate-400">扫描样本</p>
                  <p class="text-2xl font-black text-slate-900 mt-1">{{ riskResult.reviewedCount || 0 }}</p>
                </div>
                <div class="p-4">
                  <p class="text-xs font-bold text-slate-400">命中记录</p>
                  <p class="text-2xl font-black text-slate-900 mt-1">{{ riskResult.matchedCount || 0 }}</p>
                </div>
              </div>
            </div>

            <div v-if="riskResult" class="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              <div class="px-4 sm:px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 class="font-black text-slate-900">相似失败记录</h3>
                  <p class="text-xs text-slate-400 mt-1">按相似度排序，优先看失败原因和原始任务。</p>
                </div>
                <span class="self-start sm:self-auto text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">{{ riskResult.matches?.length || 0 }} 条</span>
              </div>
              <div v-if="!riskResult.matches?.length" class="px-5 py-10 text-center">
                <p class="text-sm font-semibold text-slate-700">没有命中相似失败记录</p>
                <p class="text-xs text-slate-400 mt-1">这不代表一定成功，只表示历史失败库里暂未发现相似项。</p>
              </div>
              <div v-else class="divide-y divide-slate-100">
                <div v-for="item in riskVisibleMatches()" :key="item.id" class="p-4 sm:p-5 hover:bg-slate-50 transition">
                  <div class="flex flex-col gap-3">
                    <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                          <span class="border px-2.5 py-1 rounded-lg" :class="riskSimilarityClass(item.similarity)">相似 {{ riskScorePercent(item.similarity) }}</span>
                          <span class="text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">{{ item.type }}</span>
                          <span class="text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">{{ item.model || '-' }}</span>
                          <span class="text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg">{{ new Date(item.updatedAt).toLocaleString() }}</span>
                        </div>
                        <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-3">
                          <div class="h-full rounded-full" :class="riskSimilarityBarClass(item.similarity)" :style="{ width: riskScorePercent(item.similarity) }"></div>
                        </div>
                      </div>
                      <div class="flex flex-wrap gap-2 shrink-0">
                        <button @click="openRiskMatchTask(item)" class="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-3 py-2 rounded-lg">查看任务</button>
                        <button @click="inspectFailurePrompt(item)" class="text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg">带入筛选</button>
                        <button @click="nativeCopy(item.prompt)" class="text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg">复制</button>
                      </div>
                    </div>
                    <p class="text-sm font-semibold text-slate-800 break-words leading-6">{{ shortText(item.prompt, 220) }}</p>
                    <p v-if="item.reason" class="text-xs text-red-600 break-words leading-5 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{{ shortText(item.reason, 220) }}</p>
                  </div>
                </div>
                <div v-if="riskHiddenMatchCount()" class="px-5 py-4 bg-slate-50 border-t border-slate-100">
                  <button @click="riskShowAllMatches = !riskShowAllMatches" class="w-full text-xs font-black text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 px-4 py-2.5 rounded-lg">
                    {{ riskShowAllMatches ? '收起记录' : `展开剩余 ${riskHiddenMatchCount()} 条` }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-5 min-w-0">
            <div class="bg-white rounded-lg shadow-sm border p-5" :class="riskResult ? riskPanelAccentClass(riskResult.level) : 'border-slate-200'">
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs font-bold text-slate-400 uppercase tracking-wider">风险结论</p>
                <span v-if="riskResult" class="border px-3 py-1.5 rounded-lg text-xs font-black" :class="riskLevelClass(riskResult.level)">{{ riskActionLabel(riskResult.level) }}</span>
              </div>
              <template v-if="riskResult">
                <div class="mt-5">
                  <div class="flex items-end justify-between gap-3">
                    <p class="text-4xl font-black text-slate-950">{{ riskScorePercent(riskResult.highestSimilarity || 0) }}</p>
                    <p class="text-xs text-slate-400 pb-1">最高相似度</p>
                  </div>
                  <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-4">
                    <div class="h-full rounded-full" :class="riskAccentClass(riskResult.level)" :style="{ width: riskScorePercent(riskResult.highestSimilarity || 0) }"></div>
                  </div>
                </div>
                <p class="text-sm text-slate-700 leading-6 mt-5 bg-slate-50 border border-slate-100 rounded-lg px-3 py-3">{{ riskResult.suggestion }}</p>
                <div v-if="riskResult.recommendations?.length" class="mt-4 space-y-2">
                  <p v-for="item in riskResult.recommendations" :key="item" class="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2 leading-5">{{ item }}</p>
                </div>
                <div v-if="riskResult.thresholds" class="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
                  <span class="bg-slate-100 px-2.5 py-1 rounded-lg">低 {{ riskScorePercent(riskResult.thresholds.low) }}</span>
                  <span class="bg-slate-100 px-2.5 py-1 rounded-lg">中 {{ riskScorePercent(riskResult.thresholds.medium) }}</span>
                  <span class="bg-slate-100 px-2.5 py-1 rounded-lg">高 {{ riskScorePercent(riskResult.thresholds.high) }}</span>
                </div>
              </template>
              <template v-else>
                <p class="text-3xl font-black text-slate-900 mt-5">待检查</p>
                <p class="text-sm text-slate-500 leading-6 mt-3">粘贴提示词后开始预检，系统会返回与历史失败记录的相似度和可追溯任务。</p>
              </template>
            </div>

            <div v-if="riskResult?.topReasons?.length" class="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 class="font-black text-slate-900">高频失败原因</h3>
                  <p class="text-xs text-slate-400 mt-1">来自本次命中的相似失败记录</p>
                </div>
                <button v-if="riskHiddenReasonCount()" @click="riskShowAllReasons = !riskShowAllReasons" class="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg shrink-0">{{ riskShowAllReasons ? '收起' : '更多' }}</button>
              </div>
              <div class="divide-y divide-slate-100 border-y border-slate-100">
                <div v-for="item in riskVisibleReasons()" :key="item.reason" class="py-3">
                  <div class="flex items-start justify-between gap-3">
                    <p class="text-xs text-red-700 leading-5 break-words">{{ item.reason }}</p>
                    <span class="text-xs font-black text-red-500 bg-red-50 border border-red-100 rounded-lg px-2 py-1 shrink-0">{{ item.count }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
              <div class="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 class="font-black text-slate-900">高频失败提示词</h3>
                  <p class="text-xs text-slate-400 mt-1">用于快速复核和改写</p>
                </div>
                <button @click="fetchStats" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg shrink-0">更新</button>
              </div>
              <div v-if="!stats?.failures?.byPrompt?.length" class="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 rounded-lg">暂无失败提示词数据</div>
              <div v-else class="space-y-2">
                <button v-for="item in stats.failures.byPrompt.slice(0, 8)" :key="`${item.prompt}-${item.model}-${item.type}`" @click="openRiskWithPrompt(item.prompt, item.model, item.type)" class="w-full text-left bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 rounded-lg px-4 py-3 transition">
                  <div class="flex items-start justify-between gap-3">
                    <span class="text-xs leading-5 break-words">{{ item.promptPreview }}</span>
                    <span class="text-xs font-black shrink-0">{{ item.count }}</span>
                  </div>
                  <p class="text-[11px] text-red-400 mt-1">{{ item.type }} · {{ item.model || '-' }}</p>
                </button>
                <p v-if="stats.failures.byPrompt.length > 8" class="text-[11px] text-slate-400 text-center pt-1">已显示前 8 条，共 {{ stats.failures.byPrompt.length }} 条</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== TAB: TASKS ========== -->
      <div v-if="currentTab === 'tasks'" class="space-y-6">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:flex xl:items-center gap-3 w-full">
            <select v-model="taskFilterStatus" @change="fetchTasks(1)" class="w-full xl:w-auto border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <option value="">全部状态</option>
              <option value="PENDING">PENDING</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
            <select v-model="taskFilterAccountId" @change="fetchTasks(1)" class="w-full xl:w-auto border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <option value="">全部账号</option>
              <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
            </select>
            <input v-model="taskFilterPrompt" @keyup.enter="fetchTasks(1)" placeholder="搜索提示词" class="w-full xl:w-56 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
            <input v-model="taskFilterError" @keyup.enter="fetchTasks(1)" placeholder="搜索失败原因" class="w-full xl:w-56 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
            <button @click="fetchTasks(1)" :disabled="taskLoading" class="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm">筛选</button>
            <button @click="clearTaskFilters(); fetchTasks(1)" class="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-5 py-2.5 rounded-lg font-bold text-sm">清空</button>
            <button @click="fetchTasks(taskPage)" :disabled="taskLoading" class="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm">刷新</button>
          </div>
        </div>

        <div v-if="stats?.failures?.byPrompt?.length" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-black text-slate-800">失败提示词快捷筛选</h3>
            <button @click="fetchStats" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">更新统计</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-for="item in stats.failures.byPrompt" :key="`${item.prompt}-${item.model}-${item.type}`" @click="inspectFailurePrompt(item)" class="text-xs text-left bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 rounded-lg px-3 py-2 max-w-sm">
              <span class="font-bold">{{ item.count }} 次</span>
              <span class="ml-2">{{ item.promptPreview }}</span>
            </button>
          </div>
        </div>

        <div v-if="taskFilterStatus || taskFilterAccountId || taskFilterPrompt || taskFilterError" class="flex flex-wrap gap-2 text-xs">
          <span v-if="taskFilterStatus" class="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full">状态：{{ taskFilterStatus }}</span>
          <span v-if="taskFilterAccountId" class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full">账号：{{ accounts.find((acc: any) => acc.id === taskFilterAccountId)?.name || taskFilterAccountId }}</span>
          <span v-if="taskFilterPrompt" class="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">提示词：{{ shortText(taskFilterPrompt, 42) }}</span>
          <span v-if="taskFilterError" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-full">失败原因：{{ shortText(taskFilterError, 42) }}</span>
        </div>

        <div class="md:hidden space-y-3">
          <div v-if="taskLoading" class="bg-white rounded-2xl border border-slate-200 py-10 text-center text-sm text-slate-400">加载中...</div>
          <div v-else-if="tasks.length === 0" class="bg-white rounded-2xl border border-slate-200 py-10 text-center text-sm text-slate-400">暂无任务</div>
          <template v-else>
            <div v-for="task in tasks" :key="`mobile-${task.id}`" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <span class="text-xs font-bold px-2 py-1 rounded-full" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
                  <p class="text-xs text-slate-400 mt-2">{{ new Date(task.createdAt).toLocaleString() }}</p>
                </div>
                <button @click="openTaskDetail(task)" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition shrink-0">详情</button>
              </div>
              <div class="grid grid-cols-2 gap-3 text-xs">
                <div class="bg-slate-50 rounded-xl p-3 min-w-0">
                  <p class="font-bold text-slate-400">类型</p>
                  <p class="font-mono text-slate-700 mt-1 break-words">{{ task.type || '-' }}</p>
                </div>
                <div class="bg-slate-50 rounded-xl p-3 min-w-0">
                  <p class="font-bold text-slate-400">账号</p>
                  <p class="text-slate-700 mt-1 break-words">{{ task.account?.name || '-' }}</p>
                </div>
                <div class="col-span-2 bg-slate-50 rounded-xl p-3 min-w-0">
                  <p class="font-bold text-slate-400">模型</p>
                  <p class="font-mono text-slate-700 mt-1 break-words">{{ task.model || '-' }}</p>
                </div>
              </div>
              <div>
                <p class="text-xs font-bold text-slate-400 mb-1">提示词</p>
                <p class="text-sm text-slate-700 leading-6 break-words">{{ shortText(task.prompt, 160) || '-' }}</p>
                <p v-if="task.errorMsg || task.pollErrorMsg" class="text-xs text-red-500 mt-2 break-words leading-5">{{ shortText(task.errorMsg || task.pollErrorMsg, 140) }}</p>
              </div>
              <div class="flex flex-wrap gap-2 pt-1">
                <button v-if="task.status !== 'SUCCESS' && task.status !== 'FAILED'" @click="stopTrackingTask(task.id)" :disabled="failingId === task.id" class="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition">停止跟踪</button>
                <button v-if="task.status === 'FAILED' && task.jimengSubmitId" @click="retryTask(task.id)" :disabled="retryingId === task.id" class="text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition">重试</button>
              </div>
            </div>
          </template>
        </div>

        <div class="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
          <table class="w-full min-w-[960px] text-sm">
            <thead class="bg-slate-50 border-b border-slate-200">
              <tr>
                <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">状态</th>
                <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">类型</th>
                <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">模型</th>
                <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">账号</th>
                <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">提示词 / 错误</th>
                <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">提交时间</th>
                <th class="text-left px-4 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-if="taskLoading"><td colspan="7" class="text-center py-12 text-slate-400">加载中...</td></tr>
              <tr v-else-if="tasks.length === 0"><td colspan="7" class="text-center py-12 text-slate-400">暂无任务</td></tr>
              <tr v-for="task in tasks" :key="task.id" class="hover:bg-slate-50 transition">
                <td class="px-4 py-3">
                  <span class="text-xs font-bold px-2 py-1 rounded-full" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
                </td>
                <td class="px-4 py-3 text-xs font-mono text-slate-600">{{ task.type }}</td>
                <td class="px-4 py-3 text-xs text-slate-500">{{ task.model || '-' }}</td>
                <td class="px-4 py-3 text-xs text-slate-500">{{ task.account?.name || '-' }}</td>
                <td class="px-4 py-3 text-xs max-w-md">
                  <p class="text-slate-700 break-words">{{ shortText(task.prompt, 84) || '-' }}</p>
                  <p v-if="task.errorMsg || task.pollErrorMsg" class="text-red-500 mt-1 break-words">{{ shortText(task.errorMsg || task.pollErrorMsg, 96) }}</p>
                </td>
                <td class="px-4 py-3 text-xs text-slate-400">{{ new Date(task.createdAt).toLocaleString() }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <button @click="openTaskDetail(task)" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition">详情</button>
                    <button v-if="task.status !== 'SUCCESS' && task.status !== 'FAILED'" @click="stopTrackingTask(task.id)" :disabled="failingId === task.id" class="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition">停止跟踪</button>
                    <button v-if="task.status === 'FAILED' && task.jimengSubmitId" @click="retryTask(task.id)" :disabled="retryingId === task.id" class="text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition">重试</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页 -->
        <div v-if="taskTotal > taskLimit" class="flex items-center justify-between text-sm text-slate-500">
          <span>共 {{ taskTotal }} 条，第 {{ taskPage }} / {{ Math.ceil(taskTotal / taskLimit) }} 页</span>
          <div class="flex gap-2">
            <button @click="fetchTasks(taskPage - 1)" :disabled="taskPage <= 1" class="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40">上一页</button>
            <button @click="fetchTasks(taskPage + 1)" :disabled="taskPage >= Math.ceil(taskTotal / taskLimit)" class="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40">下一页</button>
          </div>
        </div>

        <TaskDetailModal
          v-if="taskDetail"
          :task="taskDetail"
          :token="token"
          :live-status="taskLiveStatus"
          :live-loading="taskLiveLoading"
          :live-error="taskLiveError"
          :failing-id="failingId"
          v-model:fail-reason="failReason"
          @close="taskDetail = null"
          @refresh-live="refreshTaskLiveStatus"
          @stop-tracking="stopTrackingTask"
        />
      </div>

      <!-- ========== TAB: SETTINGS ========== -->
      <div v-if="currentTab === 'settings'" class="max-w-xl space-y-6">
        <form @submit.prevent="doUpdatePassword" class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <input v-model="oldPassword" type="password" required placeholder="当前密码" class="w-full border px-4 py-3 rounded-lg" />
          <input v-model="newPassword" type="password" required placeholder="新密码" class="w-full border px-4 py-3 rounded-lg" />
          <button type="submit" class="bg-slate-900 text-white font-bold px-6 py-3 rounded-xl w-full">修改凭证</button>
          <p v-if="pwdError" class="text-red-500 text-sm mt-4">{{ pwdError }}</p>
          <p v-if="pwdMessage" class="text-emerald-500 text-sm mt-4">{{ pwdMessage }}</p>
        </form>
      </div>

    </main>
  </div>
</template>
<style>
.custom-scrollbar::-webkit-scrollbar { width: 8px; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
</style>
