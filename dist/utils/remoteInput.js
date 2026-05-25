"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSafeRemoteUrl = assertSafeRemoteUrl;
exports.downloadRemoteInput = downloadRemoteInput;
const axios_1 = __importDefault(require("axios"));
const promises_1 = __importDefault(require("dns/promises"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const net_1 = __importDefault(require("net"));
function isPrivateIPv4(address) {
    const parts = address.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
        return true;
    const [a, b] = parts;
    return a === 10
        || a === 127
        || a === 0
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 192 && b === 0)
        || (a === 169 && b === 254)
        || (a === 198 && (b === 18 || b === 19))
        || (a >= 224);
}
function mappedIPv4FromIPv6(address) {
    const lower = address.toLowerCase();
    if (!lower.startsWith('::ffff:'))
        return null;
    const tail = lower.slice('::ffff:'.length);
    if (net_1.default.isIP(tail) === 4)
        return tail;
    const hexParts = tail.split(':');
    if (hexParts.length !== 2)
        return null;
    const hi = Number.parseInt(hexParts[0], 16);
    const lo = Number.parseInt(hexParts[1], 16);
    if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) {
        return null;
    }
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}
function isPrivateIPv6(address) {
    const lower = address.toLowerCase();
    const mappedIPv4 = mappedIPv4FromIPv6(lower);
    if (mappedIPv4)
        return isPrivateIPv4(mappedIPv4);
    return lower === '::1'
        || lower === '::'
        || lower.startsWith('fc')
        || lower.startsWith('fd')
        || lower.startsWith('fe80:')
        || lower.startsWith('ff');
}
function isBlockedAddress(address) {
    const type = net_1.default.isIP(address);
    if (type === 4)
        return isPrivateIPv4(address);
    if (type === 6)
        return isPrivateIPv6(address);
    return true;
}
async function assertSafeRemoteUrl(rawUrl) {
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        throw new Error('remote URL is invalid');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('remote URL must use http or https');
    }
    if (url.username || url.password) {
        throw new Error('remote URL credentials are not allowed');
    }
    const hostname = normalizeHostname(url.hostname);
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error('remote URL host is not allowed');
    }
    if (net_1.default.isIP(hostname)) {
        if (isBlockedAddress(hostname))
            throw new Error('remote URL points to a private or local address');
        return url;
    }
    const records = await promises_1.default.lookup(hostname, { all: true, verbatim: true });
    if (!records.length)
        throw new Error('remote URL host cannot be resolved');
    if (records.some((record) => isBlockedAddress(record.address))) {
        throw new Error('remote URL resolves to a private or local address');
    }
    return url;
}
function normalizeHostname(hostname) {
    const lower = hostname.toLowerCase();
    if (lower.startsWith('[') && lower.endsWith(']')) {
        return lower.slice(1, -1);
    }
    return lower;
}
function createSafeLookup() {
    return async (hostname, options, callback) => {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        try {
            const normalized = normalizeHostname(hostname);
            if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost')) {
                throw new Error('remote URL host is not allowed');
            }
            const literalFamily = net_1.default.isIP(normalized);
            if (literalFamily) {
                if (isBlockedAddress(normalized))
                    throw new Error('remote URL points to a private or local address');
                callback(null, normalized, literalFamily);
                return;
            }
            const records = await promises_1.default.lookup(normalized, {
                all: true,
                family: options?.family || 0,
                verbatim: true,
            });
            const safeRecords = records.filter((record) => !isBlockedAddress(record.address));
            if (!safeRecords.length)
                throw new Error('remote URL resolves to a private or local address');
            if (options?.all) {
                callback(null, safeRecords);
                return;
            }
            const first = safeRecords[0];
            callback(null, first.address, first.family);
        }
        catch (error) {
            callback(error);
        }
    };
}
async function downloadRemoteInput(rawUrl, options) {
    const url = await assertSafeRemoteUrl(rawUrl);
    const safeLookup = createSafeLookup();
    const response = await (0, axios_1.default)({
        url: url.toString(),
        responseType: 'arraybuffer',
        timeout: options.timeoutMs ?? 30000,
        maxRedirects: 0,
        maxContentLength: options.maxBytes,
        maxBodyLength: options.maxBytes,
        httpAgent: new http_1.default.Agent({ lookup: safeLookup }),
        httpsAgent: new https_1.default.Agent({ lookup: safeLookup }),
        proxy: false,
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`remote URL returned HTTP ${response.status}; redirects are not allowed`);
    }
    const buffer = Buffer.from(response.data);
    if (buffer.length > options.maxBytes) {
        throw new Error(`remote file exceeds ${(options.maxBytes / 1024 / 1024).toFixed(0)}MB`);
    }
    return {
        buffer,
        contentType: String(response.headers?.['content-type'] || ''),
        url,
    };
}
//# sourceMappingURL=remoteInput.js.map