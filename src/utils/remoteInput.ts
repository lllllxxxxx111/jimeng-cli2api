import axios from 'axios';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';

type DownloadOptions = {
  maxBytes: number;
  timeoutMs?: number;
};

type DownloadResult = {
  buffer: Buffer;
  contentType: string;
  url: URL;
};

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
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

function mappedIPv4FromIPv6(address: string): string | null {
  const lower = address.toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;
  const tail = lower.slice('::ffff:'.length);
  if (net.isIP(tail) === 4) return tail;

  const hexParts = tail.split(':');
  if (hexParts.length !== 2) return null;
  const hi = Number.parseInt(hexParts[0], 16);
  const lo = Number.parseInt(hexParts[1], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) {
    return null;
  }
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mappedIPv4 = mappedIPv4FromIPv6(lower);
  if (mappedIPv4) return isPrivateIPv4(mappedIPv4);
  return lower === '::1'
    || lower === '::'
    || lower.startsWith('fc')
    || lower.startsWith('fd')
    || lower.startsWith('fe80:')
    || lower.startsWith('ff');
}

function isBlockedAddress(address: string): boolean {
  const type = net.isIP(address);
  if (type === 4) return isPrivateIPv4(address);
  if (type === 6) return isPrivateIPv6(address);
  return true;
}

export async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
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

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error('remote URL points to a private or local address');
    return url;
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('remote URL host cannot be resolved');
  if (records.some((record) => isBlockedAddress(record.address))) {
    throw new Error('remote URL resolves to a private or local address');
  }

  return url;
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith('[') && lower.endsWith(']')) {
    return lower.slice(1, -1);
  }
  return lower;
}

function createSafeLookup() {
  return async (hostname: string, options: any, callback: any) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    try {
      const normalized = normalizeHostname(hostname);
      if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost')) {
        throw new Error('remote URL host is not allowed');
      }

      const literalFamily = net.isIP(normalized);
      if (literalFamily) {
        if (isBlockedAddress(normalized)) throw new Error('remote URL points to a private or local address');
        callback(null, normalized, literalFamily);
        return;
      }

      const records = await dns.lookup(normalized, {
        all: true,
        family: options?.family || 0,
        verbatim: true,
      });
      const safeRecords = records.filter((record) => !isBlockedAddress(record.address));
      if (!safeRecords.length) throw new Error('remote URL resolves to a private or local address');

      if (options?.all) {
        callback(null, safeRecords);
        return;
      }
      const first = safeRecords[0];
      callback(null, first.address, first.family);
    } catch (error) {
      callback(error);
    }
  };
}

export async function downloadRemoteInput(rawUrl: string, options: DownloadOptions): Promise<DownloadResult> {
  const url = await assertSafeRemoteUrl(rawUrl);
  const safeLookup = createSafeLookup();
  const response = await axios({
    url: url.toString(),
    responseType: 'arraybuffer',
    timeout: options.timeoutMs ?? 30000,
    maxRedirects: 0,
    maxContentLength: options.maxBytes,
    maxBodyLength: options.maxBytes,
    httpAgent: new http.Agent({ lookup: safeLookup }),
    httpsAgent: new https.Agent({ lookup: safeLookup }),
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
