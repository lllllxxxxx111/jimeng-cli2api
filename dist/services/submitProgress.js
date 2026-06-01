"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubmitProgress = exports.updateSubmitProgress = exports.normalizeSubmitProgressId = void 0;
const TTL_MS = 10 * 60 * 1000;
const progressMap = new Map();
const now = () => Date.now();
const cleanup = () => {
    const deadline = now() - TTL_MS;
    for (const [id, item] of progressMap) {
        if (item.updatedAt < deadline)
            progressMap.delete(id);
    }
};
const normalizeSubmitProgressId = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 96)
        return '';
    return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : '';
};
exports.normalizeSubmitProgressId = normalizeSubmitProgressId;
const updateSubmitProgress = (id, phase, patch = {}) => {
    const safeId = (0, exports.normalizeSubmitProgressId)(id);
    if (!safeId)
        return;
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
exports.updateSubmitProgress = updateSubmitProgress;
const getSubmitProgress = (id) => {
    const safeId = (0, exports.normalizeSubmitProgressId)(id);
    if (!safeId)
        return null;
    cleanup();
    const item = progressMap.get(safeId);
    if (!item)
        return null;
    return {
        ...item,
        elapsedMs: now() - item.startedAt,
    };
};
exports.getSubmitProgress = getSubmitProgress;
//# sourceMappingURL=submitProgress.js.map