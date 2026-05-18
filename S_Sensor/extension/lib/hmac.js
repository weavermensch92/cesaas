// lib/hmac.js — HMAC-SHA256 request signing (C_04_인증 § 2).
// payload = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`

export async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sign(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sign a request and return HMAC headers.
 *   { method, path, body: Uint8Array | string, secret, keyId }
 */
export async function buildHmacHeaders({ method, path, body, secret, keyId }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomHex(8);
  const bodyHash = await sha256Hex(body);
  const payload = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signature = await sign(secret, payload);

  return {
    Authorization: `HMAC ${keyId}:${signature}`,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
  };
}

function randomHex(byteLen) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
