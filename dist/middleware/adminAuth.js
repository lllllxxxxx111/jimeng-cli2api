"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuth = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = require("crypto");
const configDir = path_1.default.resolve(__dirname, '../../data');
if (!fs_1.default.existsSync(configDir))
    fs_1.default.mkdirSync(configDir, { recursive: true });
const configPath = path_1.default.resolve(configDir, 'admin.json');
if (!fs_1.default.existsSync(configPath)) {
    const initialPassword = process.env.ADMIN_PASSWORD || (0, crypto_1.randomBytes)(18).toString('base64url');
    const hash = bcryptjs_1.default.hashSync(initialPassword, 10);
    const token = 'admin_token_' + (0, crypto_1.randomBytes)(32).toString('hex');
    fs_1.default.writeFileSync(configPath, JSON.stringify({ password: hash, token }));
    if (!process.env.ADMIN_PASSWORD) {
        const bootstrapPath = path_1.default.resolve(configDir, 'admin_bootstrap_password.txt');
        fs_1.default.writeFileSync(bootstrapPath, initialPassword, { encoding: 'utf8', mode: 0o600 });
        console.warn(`[Admin] Generated bootstrap password at ${bootstrapPath}. Change it after first login.`);
    }
}
else {
    // Migrate plaintext password to bcrypt hash on first run after upgrade
    const config = JSON.parse(fs_1.default.readFileSync(configPath, 'utf8'));
    if (config.password && !config.password.startsWith('$2')) {
        config.password = bcryptjs_1.default.hashSync(config.password, 10);
        fs_1.default.writeFileSync(configPath, JSON.stringify(config));
    }
}
const safeTokenEqual = (left, right) => {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && (0, crypto_1.timingSafeEqual)(a, b);
};
const adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split(' ')[1];
    const config = JSON.parse(fs_1.default.readFileSync(configPath, 'utf8'));
    if (!safeTokenEqual(token, String(config.token || ''))) {
        return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }
    next();
};
exports.adminAuth = adminAuth;
//# sourceMappingURL=adminAuth.js.map