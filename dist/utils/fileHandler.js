"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupTempFile = exports.saveTempFile = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const remoteInput_1 = require("./remoteInput");
const tempDir = path_1.default.resolve(__dirname, '../../data/temp_inputs');
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const fileInputError = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
};
// Ensure temp dir exists
if (!fs_1.default.existsSync(tempDir)) {
    fs_1.default.mkdirSync(tempDir, { recursive: true });
}
/**
 * Handle base64, URL, or local file buffer and save it to a temporary file
 */
const saveTempFile = async (input, ext = '.png') => {
    const fileName = `${(0, crypto_1.randomUUID)()}${ext}`;
    const filePath = path_1.default.join(tempDir, fileName);
    if (Buffer.isBuffer(input)) {
        fs_1.default.writeFileSync(filePath, input);
        return filePath;
    }
    if (typeof input === 'string') {
        if (input.startsWith('http://') || input.startsWith('https://')) {
            let response;
            try {
                response = await (0, remoteInput_1.downloadRemoteInput)(input, { maxBytes: IMAGE_MAX_BYTES });
            }
            catch (error) {
                throw fileInputError(error.message || 'remote image URL is not allowed');
            }
            fs_1.default.writeFileSync(filePath, response.buffer);
            return filePath;
        }
        else if (input.startsWith('data:image')) {
            // Base64
            const matches = input.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                if (buffer.length > IMAGE_MAX_BYTES)
                    throw fileInputError('image input exceeds the 30MB limit');
                fs_1.default.writeFileSync(filePath, buffer);
                return filePath;
            }
        }
    }
    throw fileInputError('Unsupported file input format');
};
exports.saveTempFile = saveTempFile;
const cleanupTempFile = (filePath) => {
    if (fs_1.default.existsSync(filePath)) {
        try {
            fs_1.default.unlinkSync(filePath);
        }
        catch (e) {
            console.error(`Failed to cleanup file ${filePath}`, e);
        }
    }
};
exports.cleanupTempFile = cleanupTempFile;
//# sourceMappingURL=fileHandler.js.map