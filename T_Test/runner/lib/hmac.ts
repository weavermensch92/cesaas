// HMAC-SHA256 (Node webcrypto) — Extension의 signRequest 미러.
import { webcrypto as crypto } from 'node:crypto';

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildHmacHeaders(args: {
  method: 'POST';
  path: string;          // 함수 base 안에서의 path (예: '/captures-chunks')
  body: string | Uint8Array;
  keyId: string;
  secret: string;
}): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomHex(8);
  const bodyHash = await sha256Hex(args.body);
  const payload = `${args.method}\n${args.path}\n${ts}\n${nonce}\n${bodyHash}`;
  const sig = await sign(args.secret, payload);
  return {
    Authorization: `HMAC ${args.keyId}:${sig}`,
    'X-Timestamp': ts,
    'X-Nonce': nonce,
  };
}

function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
