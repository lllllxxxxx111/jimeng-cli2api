/**
 * @file index.ts
 * @description Jimeng CLI API wrapper HTTP entrypoint.
 * @license MIT
 */

import { pollingDaemon } from './services/pollingDaemon';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import openaiRoutes from './routes/openai';
import openaiMediaRoutes from './routes/openai_media';
import adminRoutes from './routes/admin';
import { ensureDatabaseIndexes } from './services/databaseIndexes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin === 'null' || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json({ limit: '64mb' }));
app.use(express.urlencoded({ extended: true, limit: '64mb' }));

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
const frontendDist = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

// Public OpenAI-compatible media endpoints.
app.use('/v1', openaiRoutes);
app.use('/v1', openaiMediaRoutes);

// Admin API.
app.use('/admin', adminRoutes);

// Return JSON errors for APIs instead of HTML pages.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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
if (fs.existsSync(frontendDist)) {
  app.get('/*splat', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

ensureDatabaseIndexes().catch((error) => {
  console.error('[Database] Failed to ensure indexes:', error);
});
pollingDaemon.start();

app.listen(PORT, () => {
  console.log(`[Server] Jimeng OpenAI Dispatcher Server running on http://localhost:${PORT}`);
  console.log(`[Admin] Dashboard: http://localhost:${PORT}`);
  console.log(`[OpenAI] Base URL: http://localhost:${PORT}/v1`);
});
