// lib/chunk.js — 16KB chunking (S_10.04 § 3).
// 러시아 ISP throttling 임계값 우회.

export const CHUNK_SIZE = 16 * 1024;

/**
 * data URL ("data:image/webp;base64,...") → Uint8Array.
 */
export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('invalid data URL');
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function chunkBytes(bytes, size = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.subarray(i, Math.min(i + size, bytes.length)));
  }
  return chunks;
}
