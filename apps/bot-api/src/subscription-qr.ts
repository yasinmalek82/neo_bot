import { deflateSync } from 'node:zlib';

import { encode } from 'uqr';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function renderSubscriptionQrPng(url: string): Buffer {
  if (!/^https:\/\//iu.test(url) || url.length === 0 || url.length > 400) {
    throw new Error('INVALID_SUBSCRIPTION_QR');
  }
  const encoded = encode(url, { ecc: 'M' });
  return renderMatrixPng(encoded.data, 4, 4);
}

export function renderMatrixPng(
  matrix: readonly (readonly boolean[])[],
  scale: number,
  margin: number,
): Buffer {
  const size = matrix.length;
  const width = (size + margin * 2) * scale;
  const raw = Buffer.alloc((width * 3 + 1) * width);
  for (let y = 0; y < width; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const cellX = Math.floor(x / scale) - margin;
      const cellY = Math.floor(y / scale) - margin;
      const dark =
        cellX >= 0 && cellY >= 0 && cellX < size && cellY < size && matrix[cellY]?.[cellX] === true;
      const color = dark ? 0 : 255;
      const offset = rowStart + 1 + x * 3;
      raw[offset] = color;
      raw[offset + 1] = color;
      raw[offset + 2] = color;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(width, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, data]);
  const crc = crc32(payload);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
