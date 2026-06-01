export type SubmitProgressPhase = 'received' | 'checking_key' | 'key_checked' | 'preparing_request' | 'waiting_account' | 'account_ready' | 'creating_task' | 'task_created' | 'waiting_cli_slot' | 'cli_slot_acquired' | 'credentials_ready' | 'cli_cold_start' | 'starting_cli' | 'waiting_submit_id' | 'parsing_submit_id' | 'queued' | 'dry_run' | 'failed';
export type SubmitProgressSnapshot = {
    id: string;
    phase: SubmitProgressPhase;
    startedAt: number;
    updatedAt: number;
    elapsedMs: number;
    method?: string;
    path?: string;
    accountId?: string;
    accountName?: string;
    taskId?: string;
    submitId?: string;
    command?: string;
    detail?: string;
    error?: string;
    errorType?: string;
    errorCode?: string;
    done: boolean;
};
export declare const normalizeSubmitProgressId: (value: unknown) => string;
export declare const updateSubmitProgress: (id: string, phase: SubmitProgressPhase, patch?: Partial<Omit<SubmitProgressSnapshot, "id" | "phase" | "startedAt" | "updatedAt" | "elapsedMs" | "done">>) => void;
export declare const getSubmitProgress: (id: string) => SubmitProgressSnapshot | null;
//# sourceMappingURL=submitProgress.d.ts.map