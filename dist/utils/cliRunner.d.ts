/** checklogin 成功后：把注册表中最新的 token 保存到账号隔离目录 */
export declare function saveRegToken(accountHomeDir: string): Promise<void>;
/** 执行命令前：把账号的注册表 token 换入（如无备份则跳过） */
export declare function restoreRegToken(accountHomeDir: string): Promise<void>;
/** login/relogin 前：删除注册表 token，让 CLI 看到空状态并触发 Device Flow */
export declare function clearRegToken(): Promise<void>;
export interface CliRunResult {
    stdout: string;
    stderr: string;
}
export declare const DREAMINA_BIN: string;
/**
 * tokenMode:
 *   'restore' (默认) — 换入 credential.json + 恢复该账号的注册表 token（用于普通命令）
 *   'clear'          — 换入 credential.json + 清除注册表 token（用于 relogin/login，强制触发 Device Flow）
 *   'none'           — 只换 credential.json，不动注册表
 *
 * Unix 上 token 天然隔离（go-keyring fallback 跟随 HOME），无需 mutex 和 token 操作。
 * Windows 上 token 存于固定注册表键（HKCU），必须串行化。
 */
export declare function withCredSwap<T>(accountHomeDir: string, fn: () => Promise<T>, tokenMode?: 'restore' | 'clear' | 'none'): Promise<T>;
/**
 * 纯互斥锁（不做 credential 交换），用于 relogin --headless 等需要串行的操作
 * Unix 上无需串行，直接执行。
 */
export declare function withMutex<T>(fn: () => Promise<T>): Promise<T>;
/**
 * 在 relogin --headless 运行前调用（互斥锁内）：
 * 先把 real home credential 备份到其归属账号，再删除，
 * 让 relogin 看到空目录，不发起服务端 logout 请求。
 */
export declare function clearRealCredential(): void;
/**
 * checklogin 成功后调用：把真实 home 的最新 credential 备份到账号隔离目录，并记录归属
 */
export declare function saveCredentialBackup(accountHomeDir: string): void;
/**
 * 为账号生成全新的 credential.json（含唯一 random_secret_key）。
 * random_secret_key 对注册表 token 的隔离无直接影响（CLI 始终用固定注册表键），
 * 但仍需唯一 key 防止 CLI 误判 token 状态。
 */
export declare function generateFreshCredential(accountHomeDir: string): void;
/**
 * 核心调度器：使用独立的环境变量 HOME/USERPROFILE 欺骗 CLI 去隔离文件夹中读取数据
 * 同时通过 withCredSwap 保证每次执行时使用正确账号的 credential.json
 */
export declare const runJimengCommand: (command: string, accountHomeDir?: string, saveBackup?: boolean, timeoutMs?: number) => Promise<CliRunResult>;
/**
 * 在已持有 withCredSwap mutex 的情况下直接执行命令（跳过 mutex + token swap）。
 * 仅供 pollingDaemon 在已完成 swap 的上下文中并发调用同一账号的多条查询命令。
 *
 * ⚠️ 调用者必须确保：此函数只在 withCredSwap 的回调内部调用，且不切换账号。
 */
export declare const runJimengCommandInSwap: (command: string, accountHomeDir: string) => Promise<CliRunResult>;
//# sourceMappingURL=cliRunner.d.ts.map