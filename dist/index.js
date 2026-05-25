"use strict";
/**
 * @file index.ts
 * @description Jimeng CLI API wrapper HTTP entrypoint.
 * @license MIT
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pollingDaemon_1 = require("./services/pollingDaemon");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const openai_1 = __importDefault(require("./routes/openai"));
const openai_media_1 = __importDefault(require("./routes/openai_media"));
const admin_1 = __importDefault(require("./routes/admin"));
const databaseIndexes_1 = require("./services/databaseIndexes");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
const allowedOrigins = new Set((process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || origin === 'null' || allowedOrigins.has(origin))
            return callback(null, true);
        return callback(null, false);
    },
}));
app.use(express_1.default.json({ limit: '64mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '64mb' }));
const blockedPublicPaths = [
    '/data',
    '/src',
    '/prisma',
    '/dist',
    '/node_modules',
    '/frontend',
    '/temp_uploads',
    '/logs',
    '/.env',
    '/package.json',
    '/package-lock.json',
    '/tsconfig.json',
];
app.use((req, res, next) => {
    const requestPath = req.path.replace(/\\/g, '/');
    if (blockedPublicPaths.some((blocked) => requestPath === blocked || requestPath.startsWith(blocked + '/'))) {
        return res.status(404).json({ error: 'Not found' });
    }
    return next();
});
// Serve the built admin frontend.
const frontendDist = path_1.default.resolve(__dirname, '../frontend/dist');
if (fs_1.default.existsSync(frontendDist)) {
    app.use(express_1.default.static(frontendDist));
}
// Public OpenAI-compatible media endpoints.
app.use('/v1', openai_1.default);
app.use('/v1', openai_media_1.default);
// Admin API.
app.use('/admin', admin_1.default);
// Return JSON errors for APIs instead of HTML pages.
app.use((err, req, res, next) => {
    if (!err) {
        return next();
    }
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal server error';
    if (req.path.startsWith('/v1') || req.path.startsWith('/admin')) {
        return res.status(status).json({ error: { message } });
    }
    return res.status(status).send(message);
});
// Health check.
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});
// SPA fallback.
if (fs_1.default.existsSync(frontendDist)) {
    app.get('/*splat', (req, res) => {
        res.sendFile(path_1.default.join(frontendDist, 'index.html'));
    });
}
(0, databaseIndexes_1.ensureDatabaseIndexes)().catch((error) => {
    console.error('[Database] Failed to ensure indexes:', error);
});
pollingDaemon_1.pollingDaemon.start();
app.listen(PORT, () => {
    console.log(`[Server] Jimeng OpenAI Dispatcher Server running on http://localhost:${PORT}`);
    console.log(`[Admin] Dashboard: http://localhost:${PORT}`);
    console.log(`[OpenAI] Base URL: http://localhost:${PORT}/v1`);
});
//# sourceMappingURL=index.js.map