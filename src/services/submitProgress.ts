export type SubmitProgressPhase =
  | 'received'
  | 'checking_key'
  | 'key_checked'
  | 'preparing_request'
  | 'waiting_account'
  | 'account_ready'
  | 'creating_task'
  | 'task_created'
  | 'waiting_cli_slot'
  | 'cli_slot_acquired'
  | 'credentials_ready'
  | 'cli_cold_start'
  | 'starting_cli'
  | 'waiting_submit_id'
  | 'parsing_submit_id'
  | 'queued'
  | 'dry_run'
  | 'failed';

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

const TTL_MS = 10 * 60 * 1000;
const progressMap = new Map<string, Omit<SubmitProgressSnapshot, 'elapsedMs'>>();

const now = () => Date.now();

const cleanup = () => {
  const deadline = now() - TTL_MS;
  for (const [id, item] of progressMap) {
    if (item.updatedAt < deadline) progressMap.delete(id);
  }
};

export const normalizeSubmitProgressId = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 96) return '';
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : '';
};

export const updateSubmitProgress = (
  id: string,
  phase: SubmitProgressPhase,
  patch: Partial<Omit<SubmitProgressSnapshot, 'id' | 'phase' | 'startedAt' | 'updatedAt' | 'elapsedMs' | 'done'>> = {}
) => {
  const safeId = normalizeSubmitProgressId(id);
  if (!safeId) return;
  cleanup();
  const timestamp = now();
  const previous = progressMap.get(safeId);
  progressMap.set(safeId, {
    ...(previous || { id: safeId, startedAt: timestamp, done: false }),
    ...patch,
    id: safeId,
    phase,
    updatedAt: timestamp,
    done: phase === 'queued' || phase === 'dry_run' || phase === 'failed',
  });
};

export const getSubmitProgress = (id: string): SubmitProgressSnapshot | null => {
  const safeId = normalizeSubmitProgressId(id);
  if (!safeId) return null;
  cleanup();
  const item = progressMap.get(safeId);
  if (!item) return null;
  return {
    ...item,
    elapsedMs: now() - item.startedAt,
  };
};
