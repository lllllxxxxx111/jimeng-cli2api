"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runJimengCommandInSwap = exports.runJimengCommand = exports.DREAMINA_BIN = void 0;
exports.saveRegToken = saveRegToken;
exports.restoreRegToken = restoreRegToken;
exports.clearRegToken = clearRegToken;
exports.deleteRegTokenBackup = deleteRegTokenBackup;
exports.withCredSwap = withCredSwap;
exports.withMutex = withMutex;
exports.clearRealCredential = clearRealCredential;
exports.saveCredentialBackup = saveCredentialBackup;
exports.generateFreshCredential = generateFreshCredential;
const child_process_1 = require("child_process");
const util_1 = require("util");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const crypto_1 = require("crypto");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// ─── Windows Registry Token 隔离 ──────────────────────────────────────────────
// dreamina CLI 使用 zalando/go-keyring 库，将 OAuth token 以 DPAPI 保护的 base64 字符串
// 存入固定注册表路径：
//   HKCU\Software\BytedAuthClient\keychain\dreamina
//   值名 = Ynl0ZWRfY2xpX3VzZXJfdG9rZW4 (= base64("byted_cli_user_token"))
// 所有账号共用同一个注册表键，因此必须在每次命令前把对应账号的 token 换入注册表。
const REG_KEY_PATH = 'HKCU:\\Software\\BytedAuthClient\\keychain\\dreamina';
const REG_VAL_NAME = 'Ynl0ZWRfY2xpX3VzZXJfdG9rZW4'; // base64("byted_cli_user_token")
const REG_TOKEN_RELATIVE = path_1.default.join('.dreamina_cli', 'reg_token.txt'); // per-account 备份文件
const PS_DATA_DIR = path_1.default.resolve(__dirname, '../../data');
const PS_SAVE_REG = path_1.default.join(PS_DATA_DIR, 'save_reg_token.ps1');
const PS_RESTORE_REG = path_1.default.join(PS_DATA_DIR, 'restore_reg_token.ps1');
const PS_CLEAR_REG = path_1.default.join(PS_DATA_DIR, 'clear_reg_token.ps1');
/** 将 Registry 辅助 PS 脚本写入 data/ 目录（每次都覆盖写，保持最新版本） */
function writePSScripts() {
    if (process.platform !== 'win32')
        return;
    fs_1.default.mkdirSync(PS_DATA_DIR, { recursive: true });
    // 通过环境变量传路径，避免中文路径在命令行参数中乱码
    const saveReg = `$tokenFile = $env:REG_TOKEN_PATH
try {
  $val = Get-ItemPropertyValue '${REG_KEY_PATH.replace(/\\/g, '\\')}' -Name '${REG_VAL_NAME}' -ErrorAction Stop
  [System.IO.File]::WriteAllText($tokenFile, $val)
  exit 0
} catch {
  exit 1
}
`;
    const restoreReg = `$tokenFile = $env:REG_TOKEN_PATH
try {
  $val = [System.IO.File]::ReadAllText($tokenFile).Trim()
  New-Item -Path '${REG_KEY_PATH.replace(/\\/g, '\\')}' -Force | Out-Null
  Set-ItemProperty -Path '${REG_KEY_PATH.replace(/\\/g, '\\')}' -Name '${REG_VAL_NAME}' -Value $val -Type String
  exit 0
} catch {
  exit 1
}
`;
    const clearReg = `New-Item -Path '${REG_KEY_PATH.replace(/\\/g, '\\')}' -Force | Out-Null
Remove-ItemProperty -Path '${REG_KEY_PATH.replace(/\\/g, '\\')}' -Name '${REG_VAL_NAME}' -Force -ErrorAction SilentlyContinue
exit 0
`;
    fs_1.default.writeFileSync(PS_SAVE_REG, saveReg, 'utf8');
    fs_1.default.writeFileSync(PS_RESTORE_REG, restoreReg, 'utf8');
    fs_1.default.writeFileSync(PS_CLEAR_REG, clearReg, 'utf8');
}
// 启动时写一次脚本
writePSScripts();
/** checklogin 成功后：把注册表中最新的 token 保存到账号隔离目录 */
async function saveRegToken(accountHomeDir) {
    if (process.platform !== 'win32')
        return;
    const tokenFile = path_1.default.join(path_1.default.resolve(accountHomeDir), REG_TOKEN_RELATIVE);
    fs_1.default.mkdirSync(path_1.default.dirname(tokenFile), { recursive: true });
    try {
        await execAsync(`powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "${PS_SAVE_REG}"`, { env: { ...process.env, REG_TOKEN_PATH: tokenFile } });
    }
    catch (e) {
        console.warn('[saveRegToken] failed:', e.message || e);
    }
}
/** 执行命令前：把账号的注册表 token 换入（如无备份则跳过） */
async function restoreRegToken(accountHomeDir) {
    if (process.platform !== 'win32')
        return;
    const tokenFile = path_1.default.join(path_1.default.resolve(accountHomeDir), REG_TOKEN_RELATIVE);
    if (!fs_1.default.existsSync(tokenFile))
        return;
    try {
        await execAsync(`powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "${PS_RESTORE_REG}"`, { env: { ...process.env, REG_TOKEN_PATH: tokenFile } });
    }
    catch (e) {
        console.warn('[restoreRegToken] failed:', e.message || e);
    }
}
/** login/relogin 前：删除注册表 token，让 CLI 看到空状态并触发 Device Flow */
async function clearRegToken() {
    if (process.platform !== 'win32')
        return;
    try {
        await execAsync(`powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "${PS_CLEAR_REG}"`);
    }
    catch { } // 不存在时忽略
}
/** 重新授权前：删除账号目录里的旧注册表 token 备份，防止后续确认授权前恢复坏 token */
function deleteRegTokenBackup(accountHomeDir) {
    if (process.platform !== 'win32')
        return;
    const tokenFile = path_1.default.join(path_1.default.resolve(accountHomeDir), REG_TOKEN_RELATIVE);
    try {
        if (fs_1.default.existsSync(tokenFile))
            fs_1.default.unlinkSync(tokenFile);
    }
    catch { }
}
/**
 * 解析 dreamina 可执行文件路径：
 * 优先使用项目内 bin/ 目录（便于部署），找不到再 fallback 到系统 PATH 中的全局命令。
 */
function resolveDreaminaBinPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const localBin = path_1.default.resolve(__dirname, '../../bin/dreamina' + ext);
    if (fs_1.default.existsSync(localBin)) {
        return localBin; // 原始路径，不带引号
    }
    return 'dreamina'; // fallback 系统 PATH
}
// 用于 spawn() 的第一个参数（不需要引号，Node 自行处理路径）
exports.DREAMINA_BIN = resolveDreaminaBinPath();
function parseCommandLine(command) {
    const args = [];
    let current = '';
    let inQuotes = false;
    let escaping = false;
    for (const ch of command.trim()) {
        if (escaping) {
            current += ch;
            escaping = false;
            continue;
        }
        if (ch === '\\' && inQuotes) {
            escaping = true;
            continue;
        }
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (/\s/.test(ch) && !inQuotes) {
            if (current) {
                args.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (escaping)
        current += '\\';
    if (inQuotes)
        throw new Error('Invalid CLI command: unterminated quote');
    if (current)
        args.push(current);
    return args;
}
function resolveDreaminaCommand(command) {
    const parsed = parseCommandLine(command);
    if (parsed.length === 0)
        throw new Error('Invalid CLI command: empty command');
    if (parsed[0] !== 'dreamina') {
        throw new Error('Invalid CLI command: only dreamina commands are allowed');
    }
    return { file: exports.DREAMINA_BIN, args: parsed.slice(1) };
}
function formatCliExecError(error) {
    const details = [
        `message: ${error?.message || 'unknown error'}`,
        `exitCode: ${error?.code ?? 'unknown'}`,
        `signal: ${error?.signal ?? 'none'}`,
        `killed: ${error?.killed === true ? 'true' : 'false'}`,
        `stderr: ${error?.stderr || ''}`,
        `stdout: ${error?.stdout || ''}`,
    ];
    return details.join('\n');
}
/**
 * Windows 上 CLI 的 credential.json 始终写入真实用户 home 目录，无视 USERPROFILE 环境变量。
 * 解决方案：
 *   - checklogin 成功后：把真实 home 的 credential.json 备份到账号隔离目录
 *   - 每次执行命令前：把该账号的 credential.json 换入真实 home（互斥锁保证串行）
 */
const REAL_HOME = os_1.default.homedir();
const CRED_RELATIVE = path_1.default.join('.dreamina_cli', 'credential.json');
// 持久化记录"当前 real home credential 属于哪个账号"，防止进程重启后丢失
// 格式：一行纯文本，存 accountHomeDir 的绝对路径
const CRED_OWNER_FILE = path_1.default.resolve(__dirname, '../../data/.credential_owner');
function loadCredOwner() {
    try {
        if (fs_1.default.existsSync(CRED_OWNER_FILE)) {
            const v = fs_1.default.readFileSync(CRED_OWNER_FILE, 'utf8').trim();
            return v || null;
        }
    }
    catch { }
    return null;
}
function persistCredOwner(accountHomeDir) {
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(CRED_OWNER_FILE), { recursive: true });
        fs_1.default.writeFileSync(CRED_OWNER_FILE, path_1.default.resolve(accountHomeDir), 'utf8');
    }
    catch { }
}
// 简单异步互斥锁，防止多账号并发时 credential 互相覆盖
// Unix 上 go-keyring fallback 天然遵循 HOME 环境变量，无需 mutex；Windows 需要串行
const IS_WINDOWS = process.platform === 'win32';
let _mutexTail = Promise.resolve();
/**
 * tokenMode:
 *   'restore' (默认) — 换入 credential.json + 恢复该账号的注册表 token（用于普通命令）
 *   'clear'          — 换入 credential.json + 清除注册表 token（用于 relogin/login，强制触发 Device Flow）
 *   'none'           — 只换 credential.json，不动注册表
 *
 * Unix 上 token 天然隔离（go-keyring fallback 跟随 HOME），无需 mutex 和 token 操作。
 * Windows 上 token 存于固定注册表键（HKCU），必须串行化。
 */
async function withCredSwap(accountHomeDir, fn, tokenMode = 'restore', onPhase) {
    // Unix: HOME 隔离，直接执行，无需 mutex 或 token swap
    if (!IS_WINDOWS) {
        onPhase?.('credential_slot_acquired');
        onPhase?.('credential_ready');
        return fn();
    }
    let release;
    const hold = new Promise(r => { release = r; });
    const prev = _mutexTail;
    _mutexTail = hold;
    onPhase?.('waiting_credential_slot');
    await prev;
    try {
        onPhase?.('credential_slot_acquired');
        // 1. 把该账号的 credential.json 换入真实 home
        const accountCred = path_1.default.join(path_1.default.resolve(accountHomeDir), CRED_RELATIVE);
        const realCred = path_1.default.join(REAL_HOME, CRED_RELATIVE);
        if (fs_1.default.existsSync(accountCred)) {
            fs_1.default.mkdirSync(path_1.default.dirname(realCred), { recursive: true });
            fs_1.default.copyFileSync(accountCred, realCred);
            persistCredOwner(accountHomeDir);
        }
        // 2. 处理注册表 token
        if (tokenMode === 'restore') {
            await restoreRegToken(accountHomeDir);
        }
        else if (tokenMode === 'clear') {
            await clearRegToken();
        }
        onPhase?.('credential_ready');
        return await fn();
    }
    finally {
        release();
    }
}
/**
 * 纯互斥锁（不做 credential 交换），用于 relogin --headless 等需要串行的操作
 * Unix 上无需串行，直接执行。
 */
async function withMutex(fn) {
    if (!IS_WINDOWS)
        return fn();
    let release;
    const hold = new Promise(r => { release = r; });
    const prev = _mutexTail;
    _mutexTail = hold;
    await prev;
    try {
        return await fn();
    }
    finally {
        release();
    }
}
/**
 * 在 relogin --headless 运行前调用（互斥锁内）：
 * 先把 real home credential 备份到其归属账号，再删除，
 * 让 relogin 看到空目录，不发起服务端 logout 请求。
 */
function clearRealCredential() {
    const realCred = path_1.default.join(REAL_HOME, CRED_RELATIVE);
    if (fs_1.default.existsSync(realCred)) {
        // 找到当前 real home credential 的归属账号，先保存备份再删除
        const owner = loadCredOwner();
        if (owner) {
            try {
                const ownerCred = path_1.default.join(owner, CRED_RELATIVE);
                fs_1.default.mkdirSync(path_1.default.dirname(ownerCred), { recursive: true });
                fs_1.default.copyFileSync(realCred, ownerCred);
            }
            catch { }
        }
        fs_1.default.unlinkSync(realCred);
    }
}
/**
 * checklogin 成功后调用：把真实 home 的最新 credential 备份到账号隔离目录，并记录归属
 */
function saveCredentialBackup(accountHomeDir) {
    const realCred = path_1.default.join(REAL_HOME, CRED_RELATIVE);
    const accountCred = path_1.default.join(path_1.default.resolve(accountHomeDir), CRED_RELATIVE);
    if (fs_1.default.existsSync(realCred)) {
        fs_1.default.mkdirSync(path_1.default.dirname(accountCred), { recursive: true });
        fs_1.default.copyFileSync(realCred, accountCred);
        persistCredOwner(accountHomeDir);
    }
}
/**
 * 为账号生成全新的 credential.json（含唯一 random_secret_key）。
 * random_secret_key 对注册表 token 的隔离无直接影响（CLI 始终用固定注册表键），
 * 但仍需唯一 key 防止 CLI 误判 token 状态。
 */
function generateFreshCredential(accountHomeDir) {
    const key = (0, crypto_1.randomBytes)(16).toString('hex');
    const credDir = path_1.default.join(path_1.default.resolve(accountHomeDir), '.dreamina_cli');
    fs_1.default.mkdirSync(credDir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(credDir, 'credential.json'), JSON.stringify({ random_secret_key: key }, null, 2), 'utf8');
    persistCredOwner(accountHomeDir);
}
/**
 * 核心调度器：使用独立的环境变量 HOME/USERPROFILE 欺骗 CLI 去隔离文件夹中读取数据
 * 同时通过 withCredSwap 保证每次执行时使用正确账号的 credential.json
 */
const runJimengCommand = async (command, accountHomeDir, saveBackup = false, timeoutMs = 1000 * 60 * 5, onPhase, tokenMode = 'restore') => {
    const resolvedCommand = resolveDreaminaCommand(command);
    const env = { ...process.env };
    if (accountHomeDir) {
        const absoluteHome = path_1.default.resolve(accountHomeDir);
        env.HOME = absoluteHome;
        env.USERPROFILE = absoluteHome;
        env.APPDATA = absoluteHome;
        env.LOCALAPPDATA = absoluteHome;
    }
    const runFn = async () => {
        try {
            onPhase?.('process_started');
            const { stdout, stderr } = await execFileAsync(resolvedCommand.file, resolvedCommand.args, {
                env,
                timeout: timeoutMs,
                windowsHide: true,
                maxBuffer: 16 * 1024 * 1024,
            });
            // saveBackup=true 时在互斥锁内立即备份，防止其他账号在锁释放前抢占覆盖
            if (saveBackup && accountHomeDir) {
                saveCredentialBackup(accountHomeDir);
                await saveRegToken(accountHomeDir); // 保存注册表 token 到账号隔离目录
            }
            return { stdout, stderr };
        }
        finally {
            onPhase?.('process_finished');
        }
    };
    // 有 accountHomeDir 时，先换入该账号的 credential 再执行
    if (accountHomeDir) {
        try {
            return await withCredSwap(accountHomeDir, runFn, tokenMode, onPhase);
        }
        catch (error) {
            throw new Error(`CLI 执行失败:\n${formatCliExecError(error)}`);
        }
    }
    try {
        return await runFn();
    }
    catch (error) {
        throw new Error(`CLI 执行失败:\n${formatCliExecError(error)}`);
    }
};
exports.runJimengCommand = runJimengCommand;
/**
 * 在已持有 withCredSwap mutex 的情况下直接执行命令（跳过 mutex + token swap）。
 * 仅供 pollingDaemon 在已完成 swap 的上下文中并发调用同一账号的多条查询命令。
 *
 * ⚠️ 调用者必须确保：此函数只在 withCredSwap 的回调内部调用，且不切换账号。
 */
const runJimengCommandInSwap = async (command, accountHomeDir) => {
    const resolvedCommand = resolveDreaminaCommand(command);
    const env = { ...process.env };
    const absoluteHome = path_1.default.resolve(accountHomeDir);
    env.HOME = absoluteHome;
    env.USERPROFILE = absoluteHome;
    env.APPDATA = absoluteHome;
    env.LOCALAPPDATA = absoluteHome;
    try {
        const { stdout, stderr } = await execFileAsync(resolvedCommand.file, resolvedCommand.args, {
            env,
            timeout: 1000 * 60 * 5,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        return { stdout, stderr };
    }
    catch (error) {
        throw new Error(`CLI 执行失败:\n${formatCliExecError(error)}`);
    }
};
exports.runJimengCommandInSwap = runJimengCommandInSwap;
//# sourceMappingURL=cliRunner.js.map