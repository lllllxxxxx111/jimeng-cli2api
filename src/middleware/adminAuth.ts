import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'crypto';

const configDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

const configPath = path.resolve(configDir, 'admin.json');

if (!fs.existsSync(configPath)) {
  const initialPassword = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
  const hash = bcrypt.hashSync(initialPassword, 10);
  const token = 'admin_token_' + randomBytes(32).toString('hex');
  fs.writeFileSync(configPath, JSON.stringify({ password: hash, token }));
  if (!process.env.ADMIN_PASSWORD) {
    const bootstrapPath = path.resolve(configDir, 'admin_bootstrap_password.txt');
    fs.writeFileSync(bootstrapPath, initialPassword, { encoding: 'utf8', mode: 0o600 });
    console.warn(`[Admin] Generated bootstrap password at ${bootstrapPath}. Change it after first login.`);
  }
} else {
  // Migrate plaintext password to bcrypt hash on first run after upgrade
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.password && !config.password.startsWith('$2')) {
    config.password = bcrypt.hashSync(config.password, 10);
    fs.writeFileSync(configPath, JSON.stringify(config));
  }
}

const safeTokenEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }
  const token = authHeader.split(' ')[1];
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!safeTokenEqual(token, String(config.token || ''))) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
  
  next();
};
