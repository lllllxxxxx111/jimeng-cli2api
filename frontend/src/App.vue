<script setup lang="ts">
import { ref, onMounted } from 'vue';

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
const failReason = ref('');
const failingId = ref<string | null>(null);
const retryingId = ref<string | null>(null);
const riskPrompt = ref('');
const riskModel = ref('');
const riskType = ref('');
const riskLoading = ref(false);
const riskResult = ref<any>(null);
const riskError = ref('');

const currentTab = ref('accounts');

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

const getAccountMetrics = (accountId: string) => {
  const row = stats.value?.accounts?.accounts?.find((item: any) => item.id === accountId);
  return row || { totalCreatives: 0, todayCreatives: 0, processingTasks: 0, todaySuccess: 0, failedTasks: 0, todayFailed: 0 };
};

const fetchAccounts = async () => {
  try {
    const res = await authFetch('/admin/accounts');
    const data = await res.json();
    console.log('[fetchAccounts]', data);
    accounts.value = Array.isArray(data) ? data : [];
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
      successMessage.value = `账号状态已刷新：${data.account.name}`;
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
  const name = prompt("请输入新账号的名称 (例如: vip_account_1):");
  if (!name) return;
  loading.value = true;
  try {
    const res = await authFetch('/admin/accounts/login', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      errorMessage.value = data.error || "发生了未知异常";
    } else if (data.account?.id && data.verificationUri) {
      oauthModal.value = { show: true, accountId: data.account.id, accountName: name, verificationUri: data.verificationUri, userCode: data.userCode || '', deviceCode: data.deviceCode || '', expiresAt: data.expiresAt || '', isNewAccount: true };
    } else {
      errorMessage.value = '未获取到 OAuth 授权信息，请重试。';
    }
    await fetchAccounts();
  } catch (error: any) {
    errorMessage.value = "前端网络或解析错误: " + String(error.message || error);
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
      alert('您尚未在浏览器完成授权，请先打开授权链接完成验证后再点击确认。');
      return;
    }
    if (res.ok && data.success) {
      successMessage.value = `账号 "${oauthModal.value.accountName}" 授权成功！`;
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

const riskLevelLabel = (level: string) => ({
  clear: '未命中历史风险',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
}[level] || level);

const riskLevelClass = (level: string) => ({
  clear: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  low: 'bg-amber-50 text-amber-700 border-amber-100',
  medium: 'bg-orange-50 text-orange-700 border-orange-100',
  high: 'bg-red-50 text-red-700 border-red-100',
}[level] || 'bg-slate-50 text-slate-700 border-slate-100');

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

const forceFailTask = async (id: string) => {
  if (!confirm('确认强制失败该任务？')) return;
  failingId.value = id;
  try {
    const res = await authFetch(`/admin/tasks/${id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ reason: failReason.value || '管理员手动标记失败' })
    });
    const data = await res.json();
    if (res.ok) {
      successMessage.value = '任务已标记为失败';
      failReason.value = '';
      taskDetail.value = null;
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

const openTaskDetail = (task: any) => { taskDetail.value = task; };

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
});
</script>

<template>
  <div v-if="!token" class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-indigo-950 px-4">
    <div class="max-w-md w-full bg-white/10 backdrop-blur-md rounded-3xl shadow-2xl overflow-hidden border border-white/20 p-8 text-center">
      <h2 class="text-2xl font-extrabold text-white tracking-tight mb-8">即梦调度中枢 (Jimeng Hub)</h2>
      <form @submit.prevent="doLogin" class="space-y-6">
        <input v-model="loginPassword" type="password" required class="w-full bg-black/20 border border-white/10 text-white px-5 py-4 rounded-xl placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="管理员密码" />
        <p v-if="loginError" class="text-red-400 text-xs text-left">{{ loginError }}</p>
        <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-500/30">登录控制台</button>
      </form>
    </div>
  </div>

  <div v-else class="flex min-h-screen bg-[#f8fafc] text-slate-800">
    <aside class="w-64 bg-slate-900 text-white flex flex-col shadow-2xl z-10 p-6 shrink-0">
      <h1 class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 mb-8">即梦Cli_api</h1>
      <nav class="flex-1 space-y-2">
        <button @click="currentTab = 'accounts'" :class="currentTab === 'accounts' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-300 hover:bg-slate-800'" class="w-full text-left px-5 py-3 rounded-xl font-semibold">内部账号池</button>
        <button @click="currentTab = 'apikeys'" :class="currentTab === 'apikeys' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-300 hover:bg-slate-800'" class="w-full text-left px-5 py-3 rounded-xl font-semibold">API 令牌分发</button>
        <button @click="currentTab = 'monitor'; fetchStats()" :class="currentTab === 'monitor' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-300 hover:bg-slate-800'" class="w-full text-left px-5 py-3 rounded-xl font-semibold">运行监控</button>
        <button @click="currentTab = 'risk'" :class="currentTab === 'risk' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-300 hover:bg-slate-800'" class="w-full text-left px-5 py-3 rounded-xl font-semibold">失败预检</button>
        <button @click="currentTab = 'tasks'; fetchTasks(1)" :class="currentTab === 'tasks' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-300 hover:bg-slate-800'" class="w-full text-left px-5 py-3 rounded-xl font-semibold">任务管理</button>
        <button @click="currentTab = 'docs'" :class="currentTab === 'docs' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-300 hover:bg-slate-800'" class="w-full text-left px-5 py-3 rounded-xl font-semibold">API 集成文档</button>
        <button @click="currentTab = 'settings'" :class="currentTab === 'settings' ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-300 hover:bg-slate-800'" class="w-full text-left px-5 py-3 rounded-xl font-semibold mt-4">管理员安全</button>
      </nav>
      <button @click="doLogout" class="w-full bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 py-3 rounded-xl font-bold mt-4">退出系统</button>
    </aside>

    <main class="flex-1 p-10 overflow-y-auto h-screen">

      <!-- OAuth Device Flow 授权弹窗 -->
      <div v-if="oauthModal.show" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
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
          <div class="px-6 pb-6 flex gap-3">
            <button @click="closeOAuthModal" class="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl hover:bg-slate-50 transition">取消</button>
            <button @click="doCheckLogin" :disabled="checkLoginLoading" class="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition">
              {{ checkLoginLoading ? '确认中...' : '✅ 我已完成授权' }}
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
        <div class="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 class="text-3xl font-black text-slate-800">运行监控</h2>
            <p class="text-sm text-slate-500 mt-1">账号轮询、任务产量、失败提示词和运行资源概览</p>
          </div>
          <button @click="fetchStats" :disabled="statsLoading" class="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm">刷新数据</button>
        </div>

        <div v-if="statsError" class="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl text-sm font-medium">{{ statsError }}</div>
        <div v-if="statsLoading && !stats" class="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-200">运行数据加载中...</div>

        <template v-if="stats">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">账号池</p>
              <p class="text-3xl font-black text-slate-800 mt-2">{{ stats.accounts.total }}</p>
              <p class="text-xs text-slate-500 mt-1">可用 {{ stats.accounts.idle }} · 忙碌 {{ stats.accounts.busy }} · 异常 {{ stats.accounts.error }}</p>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">任务总数</p>
              <p class="text-3xl font-black text-slate-800 mt-2">{{ stats.tasks.total }}</p>
              <p class="text-xs text-slate-500 mt-1">处理中 {{ stats.tasks.processing }} · 待处理 {{ stats.tasks.pending }}</p>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">今日创意</p>
              <p class="text-3xl font-black text-emerald-600 mt-2">{{ stats.tasks.today.success }}</p>
              <p class="text-xs text-slate-500 mt-1">今日提交 {{ stats.tasks.today.total }} · 失败 {{ stats.tasks.today.failed }}</p>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">失败率</p>
              <p class="text-3xl font-black text-red-500 mt-2">{{ formatRate(stats.failures.rate) }}</p>
              <p class="text-xs text-slate-500 mt-1">今日 {{ formatRate(stats.failures.todayRate) }} · 累计失败 {{ stats.failures.total }}</p>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <p class="text-xs font-bold text-slate-400 uppercase">内存占用</p>
              <p class="text-3xl font-black text-slate-800 mt-2">{{ formatBytes(stats.runtime.memory.rss) }}</p>
              <p class="text-xs text-slate-500 mt-1">系统已用 {{ formatRate(stats.runtime.systemMemory.usedPercent / 100) }}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
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

            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 xl:col-span-2">
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

          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
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
                    <td class="px-4 py-3"><span class="text-xs font-bold px-2 py-1 rounded-full" :class="row.status === 'IDLE' ? 'bg-green-100 text-green-700' : row.status === 'BUSY' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'">{{ row.status }}</span></td>
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
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
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

            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
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

          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 class="font-black text-slate-800">最近失败任务</h3>
              <button @click="currentTab = 'tasks'; taskFilterStatus = 'FAILED'; fetchTasks(1)" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">查看全部失败</button>
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
          <h2 class="text-3xl font-black text-slate-800">内部账号池状态</h2>
          <button @click="setupNewAccount" :disabled="loading" class="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-xl font-bold shadow transition">➕ 部署新账号实例</button>
        </div>
        <div v-if="accounts.length === 0" class="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-200">
          <p class="text-5xl mb-4">🤖</p>
          <p class="font-medium">暂无账号。点击右上角「部署新账号实例」开始。</p>
        </div>
        <div v-for="acc in accounts" :key="acc.id" class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div class="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-1">
                <span class="inline-block w-3 h-3 rounded-full flex-shrink-0" :class="acc.status === 'IDLE' ? 'bg-green-400' : 'bg-red-400'"></span>
                <p class="font-bold text-lg text-slate-800">{{ acc.name }}</p>
                <span class="text-xs font-bold px-2 py-0.5 rounded-full" :class="acc.status === 'IDLE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'">{{ acc.status === 'IDLE' ? 'ACTIVE' : acc.status === 'ERROR' ? 'EXPIRED' : acc.status }}</span>
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
                {{ checkingId === acc.id ? '⏳' : '🔍' }} 检测状态
              </button>
              <button @click="reloginAccount(acc.id, acc.name)" :disabled="reloginLoadingId === acc.id" class="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                {{ reloginLoadingId === acc.id ? '⏳' : '🔗' }} 重新授权
              </button>
              <button @click="deleteAccount(acc.id, acc.name)" class="text-sm font-semibold text-white bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                🗑 删除
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== TAB: API KEYS ========== -->
      <div v-if="currentTab === 'apikeys'" class="space-y-6">
        <h2 class="text-3xl font-black text-slate-800">API 令牌分发与管理</h2>
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <h3 class="font-bold text-slate-700 text-sm uppercase tracking-wider">✚ 签发新令牌</h3>
          <div class="flex flex-wrap gap-3">
            <input v-model="apiKeyOwner" placeholder="拥有者标识 (如 client_01)" class="flex-1 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-w-[180px]" />
            <input v-model.number="apiKeyQuota" type="number" placeholder="额度上限 (留空=无限)" class="w-52 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <!-- 自定义账号下拉 -->
            <div class="relative">
              <button type="button" @click="showAccountDropdown = !showAccountDropdown" class="flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 rounded-lg text-sm hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500 outline-none min-w-[220px] justify-between">
                <span v-if="!apiKeyBoundAccountId" class="text-slate-500">🔀 不绑定（自动分配）</span>
                <template v-else>
                  <template v-for="acc in accounts" :key="acc.id">
                    <span v-if="acc.id === apiKeyBoundAccountId">
                      <span>{{ acc.status === 'IDLE' ? '✅' : acc.status === 'BUSY' ? '⏳' : '❌' }}</span>
                      <span class="font-semibold text-slate-800 ml-1">{{ acc.name }}</span>
                      <span class="text-slate-400 ml-1 text-xs">{{ acc.creditBalance ?? '?' }} 积分</span>
                    </span>
                  </template>
                </template>
                <svg class="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <div v-if="showAccountDropdown" class="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl w-72 overflow-hidden">
                <div @click="apiKeyBoundAccountId = ''; showAccountDropdown = false" class="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100">
                  <span class="text-lg">🔀</span>
                  <div>
                    <div class="text-sm font-semibold text-slate-700">不绑定</div>
                    <div class="text-xs text-slate-400">系统自动从账号池分配</div>
                  </div>
                </div>
                <div v-for="acc in accounts" :key="acc.id" @click="apiKeyBoundAccountId = acc.id; showAccountDropdown = false" class="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 cursor-pointer" :class="apiKeyBoundAccountId === acc.id ? 'bg-indigo-50' : ''">
                  <span class="text-lg">{{ acc.status === 'IDLE' ? '✅' : acc.status === 'BUSY' ? '⏳' : '❌' }}</span>
                  <div>
                    <div class="text-sm font-semibold text-slate-800">{{ acc.name }}</div>
                    <div class="text-xs text-slate-400">{{ acc.creditBalance ?? '?' }} 积分 · {{ acc.status }}</div>
                  </div>
                  <span v-if="apiKeyBoundAccountId === acc.id" class="ml-auto text-indigo-600 font-bold text-sm">✓</span>
                </div>
              </div>
            </div>
            <button @click="generateApiKey" :disabled="loading" class="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2.5 rounded-lg font-bold text-sm shadow transition">签发令牌</button>
          </div>
          <div v-if="apiKeyResult" class="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
            <p class="text-xs font-bold text-emerald-700 mb-2">✅ 新令牌已生成 — 请立即复制，此处仅显示一次</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 font-mono text-sm text-emerald-800 break-all select-all">{{ apiKeyResult }}</code>
              <button @click="copyKey(apiKeyResult)" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold flex-shrink-0 transition">📋 复制</button>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
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
                    <button @click="toggleRevealKey(key.id)" class="text-slate-400 hover:text-indigo-600 text-sm px-1 py-0.5 rounded transition" :title="revealedKeyIds.has(key.id) ? '隐藏' : '显示明文'">{{ revealedKeyIds.has(key.id) ? '🙈' : '👁' }}</button>
                    <button @click="copyKey(key.key)" class="text-slate-400 hover:text-indigo-600 text-sm px-1 py-0.5 rounded transition" title="复制">📋</button>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span v-if="key.boundAccount" class="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">🔒 {{ key.boundAccount.name }}</span>
                  <span v-else class="text-xs text-slate-400">🔀 自动分配</span>
                </td>
                <td class="px-6 py-4 text-slate-500 text-xs">{{ key.used || 0 }} / {{ key.quota || '∞' }}</td>
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
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-5">
          <div class="flex items-center justify-between">
            <h3 class="font-black text-slate-800 text-lg">🔁 修改绑定账号</h3>
            <button @click="rebindModal.show = false" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
          </div>
          <p class="text-sm text-slate-500">令牌拥有者：<span class="font-bold text-slate-700">{{ rebindModal.keyOwner }}</span></p>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-2">选择新的绑定账号</label>
            <select v-model="rebindNewAccountId" class="w-full border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <option value="">🔀 不绑定（自动分配公共池）</option>
              <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.status === 'IDLE' ? '✅' : acc.status === 'BUSY' ? '⏳' : '❌' }} {{ acc.name }}（{{ acc.creditBalance ?? '?' }} 积分）</option>
            </select>
          </div>
          <div class="flex gap-3 justify-end pt-2">
            <button @click="rebindModal.show = false" class="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition">取消</button>
            <button @click="rebindApiKey" class="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow">确认改绑</button>
          </div>
        </div>
      </div>

      <!-- ========== TAB: DOCS ========== -->
      <div v-if="currentTab === 'docs'" class="space-y-8">
        <div>
          <h2 class="text-3xl font-black text-slate-800">即梦Cli_api 集成文档</h2>
          <p class="text-slate-500 mt-1">企业级封装 • 兼容 OpenAI 格式 • 原生多模态</p>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <h3 class="font-extrabold text-amber-900 text-lg mb-3">🔑 如何获取 API Key</h3>
          <ol class="text-sm text-amber-800 space-y-2 list-decimal pl-5">
            <li>登录本控制台，切换到左侧「API 令牌分发」页面</li>
            <li>填写拥有者标识（如 <code class="bg-amber-100 px-1 rounded font-mono">client_01</code>）和可选额度上限，点击「签发令牌」</li>
            <li>令牌签发后会 <strong>明文显示一次</strong>，请立即点击「📋 复制」保存</li>
            <li>此后令牌脱敏展示，不可再查看原文。若丢失请删除后重新签发</li>
          </ol>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <h3 class="font-extrabold text-slate-800 text-lg">🌐 接入基础规范</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Base URL</p><code class="bg-slate-900 text-green-400 px-4 py-2 rounded-lg block font-mono text-xs">http://&lt;server-ip&gt;:3000/v1</code></div>
            <div><p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">认证方式 (必填 Header)</p><code class="bg-slate-900 text-green-400 px-4 py-2 rounded-lg block font-mono text-xs">Authorization: Bearer sk-jm-xxxxxxxxxx</code></div>
            <div><p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">请求 Content-Type</p><code class="bg-slate-900 text-yellow-400 px-4 py-2 rounded-lg block font-mono text-xs">multipart/form-data</code><p class="text-xs text-slate-400 mt-1">所有生成接口均使用 form-data，支持文件上传</p></div>
            <div><p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">任务状态轮询</p><code class="bg-slate-900 text-green-400 px-4 py-2 rounded-lg block font-mono text-xs">GET /v1/tasks/:id</code><p class="text-xs text-slate-400 mt-1">轮询直到 status 变为 success 或 failed</p></div>
          </div>
          <div class="mt-4 bg-slate-50 border border-slate-100 rounded-xl p-4">
            <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">能力发现</p>
            <code class="bg-slate-900 text-green-400 px-4 py-2 rounded-lg block font-mono text-xs">GET /v1/models</code>
            <p class="text-xs text-slate-400 mt-2">返回图片、视频、高清放大模型及其 capabilities，可给客户端动态渲染能力列表。</p>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
          <h3 class="font-extrabold text-slate-800 text-lg flex items-center gap-2">⚡ 异步任务响应机制 <span class="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">必读</span></h3>
          <p class="text-sm text-slate-600">两个生成接口均为<strong>异步非阻塞</strong>：POST 提交后立即返回任务 ID，后台 CLI 持续执行，客户端需持续轮询 <code class="bg-slate-100 px-1 rounded font-mono">GET /v1/tasks/:id</code> 直到获得最终 URL。</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
              <p class="text-xs font-black text-indigo-700 uppercase tracking-wider mb-2">① POST 提交 → 立即返回</p>
              <pre class="text-[11px] font-mono text-indigo-800 leading-relaxed overflow-x-auto">{
  "id": "clxxxxxxxxxxx",
  "status": "processing",
  "submit_id": "abc123"
}</pre>
              <p class="text-[11px] text-slate-500 mt-2">id 即轮询用的任务 ID，submit_id 为 CLI 内部流水号</p>
            </div>
            <div class="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <p class="text-xs font-black text-amber-700 uppercase tracking-wider mb-2">② GET /v1/tasks/:id 轮询中</p>
              <pre class="text-[11px] font-mono text-amber-800 leading-relaxed overflow-x-auto">{
  "id": "clxxxxxxxxxxx",
  "status": "processing"
}</pre>
              <p class="text-[11px] text-slate-500 mt-2">每 3–5 秒轮询一次，最长等待约 5 分钟</p>
            </div>
            <div class="space-y-3">
              <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <p class="text-xs font-black text-emerald-700 uppercase tracking-wider mb-1">③a 成功 (success)</p>
                <pre class="text-[11px] font-mono text-emerald-800 leading-relaxed overflow-x-auto">{
  "id": "clxxx",
  "status": "success",
  "data": [
    { "url": "https://cdn.xxx/out.jpg" }
  ]
}</pre>
              </div>
              <div class="bg-red-50 border border-red-100 rounded-xl p-3">
                <p class="text-xs font-black text-red-700 uppercase tracking-wider mb-1">③b 失败 (failed)</p>
                <pre class="text-[11px] font-mono text-red-800 leading-relaxed overflow-x-auto">{
  "id": "clxxx",
  "status": "failed",
  "error": "错误原因说明"
}</pre>
              </div>
            </div>
          </div>
          <div class="bg-slate-900 rounded-xl overflow-hidden">
            <div class="bg-slate-800 px-4 py-2 flex items-center gap-2">
              <span class="text-xs font-mono text-slate-400">cURL 完整链路示例 (提交 → 轮询 → 取 URL)</span>
            </div>
            <pre class="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed"># Step 1: 提交生成任务
RESP=$(curl -s -X POST http://&lt;server&gt;:3000/v1/images/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=5.0" -F "prompt=赛博朋克机械猫" -F "ratio=16:9")
TASK_ID=$(echo $RESP | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Step 2: 轮询直到 status = success
while true; do
  POLL=$(curl -s http://&lt;server&gt;:3000/v1/tasks/$TASK_ID \
    -H "Authorization: Bearer sk-jm-xxx")
  STATUS=$(echo $POLL | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  if [ "$STATUS" = "success" ]; then
    echo $POLL | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['url'])"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "FAILED"; break
  fi
  sleep 4
done</pre>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 class="font-extrabold text-slate-800 text-lg mb-4">📸 POST /v1/images/generations — 各模型参数约束</h3>
          <div class="overflow-x-auto">
            <table class="w-full text-xs border-collapse">
              <thead><tr class="bg-indigo-50">
                <th class="text-left px-4 py-3 font-bold text-indigo-700 border border-indigo-100">model</th>
                <th class="text-left px-4 py-3 font-bold text-indigo-700 border border-indigo-100">resolution_type</th>
                <th class="text-left px-4 py-3 font-bold text-indigo-700 border border-indigo-100">ratio</th>
                <th class="text-left px-4 py-3 font-bold text-indigo-700 border border-indigo-100">图生图 (images 字段)</th>
                <th class="text-left px-4 py-3 font-bold text-indigo-700 border border-indigo-100">备注</th>
              </tr></thead>
              <tbody>
                <tr class="hover:bg-slate-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">5.0</td><td class="px-4 py-3 border border-slate-100">4k / 2k</td><td class="px-4 py-3 border border-slate-100">全部比例</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 最多 10 张</td><td class="px-4 py-3 border border-slate-100 text-indigo-600 font-semibold">旗舰推荐</td></tr>
                <tr class="hover:bg-slate-50 bg-slate-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">4.6</td><td class="px-4 py-3 border border-slate-100">4k / 2k</td><td class="px-4 py-3 border border-slate-100">全部比例</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 最多 10 张</td><td class="px-4 py-3 border border-slate-100 text-slate-500">高质量</td></tr>
                <tr class="hover:bg-slate-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">4.5</td><td class="px-4 py-3 border border-slate-100">4k / 2k</td><td class="px-4 py-3 border border-slate-100">全部比例</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 最多 10 张</td><td class="px-4 py-3 border border-slate-100 text-slate-500"></td></tr>
                <tr class="hover:bg-slate-50 bg-slate-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">4.1</td><td class="px-4 py-3 border border-slate-100">4k / 2k</td><td class="px-4 py-3 border border-slate-100">全部比例</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 最多 10 张</td><td class="px-4 py-3 border border-slate-100 text-slate-500"></td></tr>
                <tr class="hover:bg-slate-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">4.0</td><td class="px-4 py-3 border border-slate-100">4k / 2k</td><td class="px-4 py-3 border border-slate-100">全部比例</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 最多 10 张</td><td class="px-4 py-3 border border-slate-100 text-slate-500"></td></tr>
                <tr class="hover:bg-slate-50 bg-orange-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">3.1</td><td class="px-4 py-3 border border-slate-100 text-orange-600">2k / 1k</td><td class="px-4 py-3 border border-slate-100">全部比例</td><td class="px-4 py-3 border border-slate-100 text-red-600 font-bold">❌ 不支持</td><td class="px-4 py-3 border border-slate-100 text-orange-600">降级分辨率</td></tr>
                <tr class="hover:bg-slate-50 bg-orange-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">3.0</td><td class="px-4 py-3 border border-slate-100 text-orange-600">2k / 1k</td><td class="px-4 py-3 border border-slate-100">全部比例</td><td class="px-4 py-3 border border-slate-100 text-red-600 font-bold">❌ 不支持</td><td class="px-4 py-3 border border-slate-100 text-orange-600">旧版基础</td></tr>
              </tbody>
            </table>
          </div>
          <pre class="mt-4 bg-slate-900 text-indigo-300 p-4 rounded-xl font-mono text-xs overflow-x-auto">curl -X POST http://&lt;server&gt;:3000/v1/images/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=5.0" -F "prompt=一只超写实的机械猫咪" -F "ratio=16:9" -F "resolution_type=4k"
# 图生图: 追加 -F "images=@/path/to/ref.jpg" (最多10张，限4.0及以上模型)</pre>
          <div class="mt-5 bg-slate-50 border border-slate-100 rounded-xl p-4">
            <h4 class="font-black text-slate-700 mb-2">POST /v1/images/upscale — 高清放大</h4>
            <p class="text-xs text-slate-500 mb-3">对应 CLI 的 image_upscale，支持 resolution_type=2k/4k/8k，可选 session。</p>
            <pre class="bg-slate-900 text-indigo-300 p-4 rounded-xl font-mono text-xs overflow-x-auto">curl -X POST http://&lt;server&gt;:3000/v1/images/upscale \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "image=@input.jpg" -F "resolution_type=4k"</pre>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 class="font-extrabold text-slate-800 text-lg mb-4">🎬 POST /v1/videos/generations — 各模型参数约束</h3>
          <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 mb-4 leading-6">
            <p><strong>mode</strong> 支持 auto、text2video、image2video、frames2video、multiframe2video、multimodal2video。</p>
            <p><strong>session</strong> 会透传给 CLI 的 --session。多图 3 张及以上可传 transition_prompt / transition_duration，数量必须等于图片数 - 1。</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs border-collapse">
              <thead><tr class="bg-blue-50">
                <th class="text-left px-4 py-3 font-bold text-blue-700 border border-blue-100">model</th>
                <th class="text-left px-4 py-3 font-bold text-blue-700 border border-blue-100">时长范围 (s)</th>
                <th class="text-left px-4 py-3 font-bold text-blue-700 border border-blue-100">最高分辨率</th>
                <th class="text-left px-4 py-3 font-bold text-blue-700 border border-blue-100">文生视频</th>
                <th class="text-left px-4 py-3 font-bold text-blue-700 border border-blue-100">图生视频</th>
                <th class="text-left px-4 py-3 font-bold text-blue-700 border border-blue-100">多模态/音频</th>
                <th class="text-left px-4 py-3 font-bold text-blue-700 border border-blue-100">备注</th>
              </tr></thead>
              <tbody>
                <tr class="bg-green-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">seedance2.0_vip</td><td class="px-4 py-3 border border-slate-100">4 – 15</td><td class="px-4 py-3 border border-slate-100">720p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 全支持</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-semibold">VIP 超极速</td></tr>
                <tr class="bg-green-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">seedance2.0fast_vip</td><td class="px-4 py-3 border border-slate-100">4 – 15</td><td class="px-4 py-3 border border-slate-100">720p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 全支持</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-semibold">VIP 极速版</td></tr>
                <tr><td class="px-4 py-3 font-mono font-bold border border-slate-100">seedance2.0</td><td class="px-4 py-3 border border-slate-100">4 – 15</td><td class="px-4 py-3 border border-slate-100">720p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 全支持</td><td class="px-4 py-3 border border-slate-100 text-slate-500">标准推荐</td></tr>
                <tr class="bg-slate-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">seedance2.0fast</td><td class="px-4 py-3 border border-slate-100">4 – 15</td><td class="px-4 py-3 border border-slate-100">720p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700 font-bold">✅ 全支持</td><td class="px-4 py-3 border border-slate-100 text-slate-500">快速出图</td></tr>
                <tr class="bg-blue-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">3.5pro</td><td class="px-4 py-3 border border-slate-100">4 – 12</td><td class="px-4 py-3 border border-slate-100 font-bold text-blue-700">1080p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-red-500">❌</td><td class="px-4 py-3 border border-slate-100 text-blue-600">高清，无多模态</td></tr>
                <tr><td class="px-4 py-3 font-mono font-bold border border-slate-100">3.0pro</td><td class="px-4 py-3 border border-slate-100">3 – 10</td><td class="px-4 py-3 border border-slate-100 font-bold text-blue-700">1080p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-red-500">❌</td><td class="px-4 py-3 border border-slate-100 text-slate-500"></td></tr>
                <tr class="bg-slate-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">3.0fast</td><td class="px-4 py-3 border border-slate-100">3 – 10</td><td class="px-4 py-3 border border-slate-100">720p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-red-500">❌</td><td class="px-4 py-3 border border-slate-100 text-slate-500">快速版</td></tr>
                <tr class="bg-orange-50"><td class="px-4 py-3 font-mono font-bold border border-slate-100">3.0</td><td class="px-4 py-3 border border-slate-100">3 – 10</td><td class="px-4 py-3 border border-slate-100">720p</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-green-700">✅</td><td class="px-4 py-3 border border-slate-100 text-red-500">❌</td><td class="px-4 py-3 border border-slate-100 text-orange-500">旧基础版</td></tr>
              </tbody>
            </table>
          </div>
          <pre class="mt-4 bg-slate-900 text-indigo-300 p-4 rounded-xl font-mono text-xs overflow-x-auto"># 文生视频
curl -X POST http://&lt;server&gt;:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=seedance2.0" -F "prompt=赛博朋克都市夜景" -F "duration=5" -F "ratio=16:9"

# 图生视频 (单图定帧)
curl -X POST http://&lt;server&gt;:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=seedance2.0" -F "prompt=让角色缓缓转身" -F "image=@face.jpg" -F "duration=5"

# 多模态 (多图+音频，自动锁定 seedance2.0 系)
curl -X POST http://&lt;server&gt;:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "model=seedance2.0_vip" -F "prompt=人物嘴型对口型说话" \
  -F "image=@face1.jpg" -F "image=@face2.jpg" -F "audio=@voice.mp3" -F "duration=8"

# 多图转场 (3 张及以上)
curl -X POST http://&lt;server&gt;:3000/v1/videos/generations \
  -H "Authorization: Bearer sk-jm-xxx" \
  -F "mode=multiframe2video" -F "image=@a.jpg" -F "image=@b.jpg" -F "image=@c.jpg" \
  -F "transition_prompt=镜头推进" -F "transition_prompt=切到夜景" \
  -F "transition_duration=3" -F "transition_duration=3"</pre>
        </div>
      </div>

      <!-- ========== TAB: PROMPT RISK ========== -->
      <div v-if="currentTab === 'risk'" class="space-y-6">
        <div>
          <h2 class="text-3xl font-black text-slate-800">失败提示词预检</h2>
          <p class="text-sm text-slate-500 mt-1">基于历史失败任务做相似度检查，先拦截高风险提示词，减少排队后失败的时间损耗</p>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
          <div class="grid grid-cols-1 xl:grid-cols-[1fr_220px_220px] gap-4">
            <div>
              <label class="block text-sm font-bold text-slate-700 mb-2">待检查提示词</label>
              <textarea v-model="riskPrompt" rows="7" placeholder="粘贴即将提交的提示词" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-y"></textarea>
            </div>
            <div>
              <label class="block text-sm font-bold text-slate-700 mb-2">模型筛选</label>
              <input v-model="riskModel" placeholder="可选，如 5.0" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <p class="text-xs text-slate-400 mt-2">留空时跨模型匹配历史失败记录</p>
            </div>
            <div>
              <label class="block text-sm font-bold text-slate-700 mb-2">任务类型</label>
              <select v-model="riskType" class="w-full border border-slate-300 px-4 py-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
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
              <button @click="checkPromptRisk" :disabled="riskLoading" class="mt-4 w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-bold text-sm">{{ riskLoading ? '检查中...' : '开始预检' }}</button>
            </div>
          </div>
          <div v-if="riskError" class="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">{{ riskError }}</div>
        </div>

        <div v-if="riskResult" class="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
            <p class="text-xs font-bold text-slate-400 uppercase">风险结论</p>
            <div class="inline-flex px-4 py-2 rounded-xl border text-sm font-black" :class="riskLevelClass(riskResult.level)">{{ riskLevelLabel(riskResult.level) }}</div>
            <div>
              <p class="text-3xl font-black text-slate-800">{{ formatRate(riskResult.highestSimilarity || 0) }}</p>
              <p class="text-xs text-slate-400 mt-1">最高相似度</p>
            </div>
            <p class="text-sm text-slate-600 leading-6">{{ riskResult.suggestion }}</p>
          </div>

          <div class="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 class="font-black text-slate-800">相似失败记录</h3>
              <span class="text-xs text-slate-400">{{ riskResult.matches?.length || 0 }} 条</span>
            </div>
            <div v-if="!riskResult.matches?.length" class="px-6 py-12 text-center text-sm text-slate-400">没有命中相似失败记录</div>
            <div v-else class="divide-y divide-slate-100">
              <div v-for="item in riskResult.matches" :key="item.id" class="p-5 hover:bg-slate-50">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-slate-800 break-words">{{ shortText(item.prompt, 150) }}</p>
                    <p class="text-xs text-slate-400 mt-1">{{ item.type }} · {{ item.model || '-' }} · {{ new Date(item.updatedAt).toLocaleString() }}</p>
                    <p v-if="item.reason" class="text-xs text-red-500 mt-2 break-words">{{ shortText(item.reason, 140) }}</p>
                  </div>
                  <button @click="taskFilterStatus = 'FAILED'; taskFilterPrompt = item.prompt; taskFilterError = ''; currentTab = 'tasks'; fetchTasks(1)" class="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg shrink-0">{{ formatRate(item.similarity) }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="stats?.failures?.byPrompt?.length" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-black text-slate-800">高频失败提示词</h3>
            <button @click="fetchStats" class="text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">更新统计</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-for="item in stats.failures.byPrompt" :key="`${item.prompt}-${item.model}-${item.type}`" @click="openRiskWithPrompt(item.prompt, item.model, item.type)" class="text-xs text-left bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 rounded-lg px-3 py-2 max-w-sm">
              <span class="font-bold">{{ item.count }} 次</span>
              <span class="ml-2">{{ item.promptPreview }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ========== TAB: TASKS ========== -->
      <div v-if="currentTab === 'tasks'" class="space-y-6">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <h2 class="text-3xl font-black text-slate-800">任务管理</h2>
          <div class="flex items-center gap-3 flex-wrap">
            <select v-model="taskFilterStatus" @change="fetchTasks(1)" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <option value="">全部状态</option>
              <option value="PENDING">PENDING</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
            </select>
            <select v-model="taskFilterAccountId" @change="fetchTasks(1)" class="border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <option value="">全部账号</option>
              <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
            </select>
            <input v-model="taskFilterPrompt" @keyup.enter="fetchTasks(1)" placeholder="搜索提示词" class="w-56 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
            <input v-model="taskFilterError" @keyup.enter="fetchTasks(1)" placeholder="搜索失败原因" class="w-56 border border-slate-300 px-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
            <button @click="fetchTasks(1)" :disabled="taskLoading" class="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm">筛选</button>
            <button @click="clearTaskFilters(); fetchTasks(1)" class="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-5 py-2.5 rounded-lg font-bold text-sm">清空</button>
            <button @click="fetchTasks(taskPage)" :disabled="taskLoading" class="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm">🔄 刷新</button>
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

        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <table class="w-full text-sm">
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
                    <button v-if="task.status !== 'SUCCESS' && task.status !== 'FAILED'" @click="forceFailTask(task.id)" :disabled="failingId === task.id" class="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition">强制失败</button>
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

        <!-- 任务详情弹窗 -->
        <div v-if="taskDetail" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" @click.self="taskDetail = null">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div class="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <h3 class="font-black text-slate-800 text-lg">任务详情</h3>
              <button @click="taskDetail = null" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
            </div>
            <div class="px-6 py-5 overflow-y-auto space-y-4 text-sm">
              <div class="grid grid-cols-2 gap-4">
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">任务 ID</p><code class="text-xs font-mono text-slate-700 break-all select-all">{{ taskDetail.id }}</code></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">状态</p><span class="text-xs font-bold px-2 py-1 rounded-full" :class="statusClass(taskDetail.status)">{{ statusLabel(taskDetail.status) }}</span></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">Submit ID</p><code class="text-xs font-mono text-slate-700 break-all select-all">{{ taskDetail.jimengSubmitId || '-' }}</code></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">Log ID</p><code class="text-xs font-mono text-slate-700 break-all select-all">{{ taskDetail.jimengLogId || '-' }}</code></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">类型</p><span class="font-mono text-xs">{{ taskDetail.type }}</span></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">模型</p><span class="font-mono text-xs">{{ taskDetail.model || '-' }}</span></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">账号</p><span>{{ taskDetail.account?.name || '-' }}</span></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">API Key 归属</p><span>{{ taskDetail.apiKey?.owner || '-' }}</span></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">创建时间</p><span>{{ new Date(taskDetail.createdAt).toLocaleString() }}</span></div>
                <div><p class="text-xs font-bold text-slate-400 uppercase mb-1">更新时间</p><span>{{ new Date(taskDetail.updatedAt).toLocaleString() }}</span></div>
              </div>
              <div v-if="taskDetail.prompt"><p class="text-xs font-bold text-slate-400 uppercase mb-1">Prompt</p><p class="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 break-words">{{ taskDetail.prompt }}</p></div>
              <div v-if="taskDetail.resultUrl"><p class="text-xs font-bold text-slate-400 uppercase mb-1">结果 URL</p><a :href="taskDetail.resultUrl" target="_blank" class="text-xs font-mono text-indigo-600 hover:underline break-all">{{ taskDetail.resultUrl }}</a></div>
              <div v-if="taskDetail.errorMsg"><p class="text-xs font-bold text-red-400 uppercase mb-1">失败原因</p><p class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 break-words">{{ taskDetail.errorMsg }}</p></div>
              <div v-if="taskDetail.pollErrorMsg"><p class="text-xs font-bold text-amber-500 uppercase mb-1">轮询异常（不代表任务失败）</p><p class="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 break-words font-mono">{{ taskDetail.pollErrorMsg }}</p></div>
              <div v-if="taskDetail.status !== 'SUCCESS' && taskDetail.status !== 'FAILED'" class="pt-2 border-t border-slate-100 space-y-2">
                <p class="text-xs font-bold text-slate-500">手动干预</p>
                <div class="flex gap-2 items-center">
                  <input v-model="failReason" placeholder="失败原因（可选）" class="flex-1 border border-slate-300 px-3 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-red-400" />
                  <button @click="forceFailTask(taskDetail.id)" :disabled="failingId === taskDetail.id" class="text-xs font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-4 py-2 rounded-lg transition">强制失败</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== TAB: SETTINGS ========== -->
      <div v-if="currentTab === 'settings'" class="max-w-xl space-y-6">
        <h2 class="text-3xl font-black text-slate-800">系统核心安全设置</h2>
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
