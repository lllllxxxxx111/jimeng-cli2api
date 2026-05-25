import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { downloadRemoteInput } from './remoteInput';

const tempDir = path.resolve(__dirname, '../../data/temp_inputs');
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;

const fileInputError = (message: string) => {
  const error = new Error(message);
  (error as any).statusCode = 400;
  return error;
};

// Ensure temp dir exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Handle base64, URL, or local file buffer and save it to a temporary file
 */
export const saveTempFile = async (input: string | Buffer, ext = '.png'): Promise<string> => {
  const fileName = `${randomUUID()}${ext}`;
  const filePath = path.join(tempDir, fileName);

  if (Buffer.isBuffer(input)) {
    fs.writeFileSync(filePath, input);
    return filePath;
  }

  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      let response;
      try {
        response = await downloadRemoteInput(input, { maxBytes: IMAGE_MAX_BYTES });
      } catch (error: any) {
        throw fileInputError(error.message || 'remote image URL is not allowed');
      }
      fs.writeFileSync(filePath, response.buffer);
      return filePath;
    } else if (input.startsWith('data:image')) {
      // Base64
      const matches = input.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const buffer = Buffer.from(matches[2], 'base64');
        if (buffer.length > IMAGE_MAX_BYTES) throw fileInputError('image input exceeds the 30MB limit');
        fs.writeFileSync(filePath, buffer);
        return filePath;
      }
    }
  }
  
  throw fileInputError('Unsupported file input format');
};

export const cleanupTempFile = (filePath: string) => {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error(`Failed to cleanup file ${filePath}`, e);
    }
  }
};
