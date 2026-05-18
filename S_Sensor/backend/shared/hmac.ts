// Deno 미러: @hd/core/hmac. C_04_인증 § 2.
// payload = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`

import { db } from './db.ts';
import { ApiError } from './errors.ts';
import { constantTimeEquals, sha256Hex } from './hash.ts';

const TIMESTAMP_DRIFT_SECONDS = 300;

export interface VerifiedIdentity {
  keyId: string;
  dealerId: string | null;
}

interface KeyRecord {
  key_id: string;
  secret: string;
  dealer_id: string | null;
  revoked_at: string | null;
  expires_at: string;
}

async function loadKey(keyId: string): Promise<KeyRecord | null> {
  const { data, error } = await db()
    .from('sensor_api_keys')
    .select('key_id, secret, dealer_id, revoked_at, expires_at')
    .eq('key_id', keyId)
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'key lookup failed', { db: error.message });
  return data as KeyRecord | null;
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyHmac(req: Request, bodyBytes: Uint8Array): Promise<VerifiedIdentity> {
  const auth = req.headers.get('authorization') ?? '';
  const tsHeader = req.headers.get('x-timestamp') ?? '';
  const nonce = req.headers.get('x-nonce') ?? '';
  if (!auth.startsWith('HMAC ') || !tsHeader || !nonce) {
    throw new ApiError('invalid_signature', 'HMAC headers missing or malformed');
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_DRIFT_SECONDS) {
    throw new ApiError('invalid_signature', 'timestamp drift exceeds 300s', {
      drift_seconds: now - ts,
    });
  }

  const sep = auth.indexOf(':');
  if (sep < 0) throw new ApiError('invalid_signature', 'malformed Authorization');
  const keyId = auth.slice(5, sep);
  const providedSig = auth.slice(sep + 1);

  const record = await loadKey(keyId);
  if (!record || record.revoked_at || new Date(record.expires_at) < new Date()) {
    throw new ApiError('invalid_signature', 'unknown or revoked key_id', { key_id: keyId });
  }

  const url = new URL(req.url);
  const bodyHash = await sha256Hex(bodyBytes);
  const payload = `${req.method}\n${url.pathname}\n${tsHeader}\n${nonce}\n${bodyHash}`;
  const expected = await signPayload(record.secret, payload);
  if (!constantTimeEquals(providedSig, expected)) {
    throw new ApiError('invalid_signature', 'signature mismatch');
  }

  // nonce 1회용
  const { error } = await db().from('hmac_nonces').insert({ key_id: keyId, nonce });
  if (error) {
    if (error.code === '23505') {
      throw new ApiError('invalid_signature', 'nonce already used', { nonce });
    }
    throw new ApiError('internal_error', 'nonce store failed', { db: error.message });
  }

  return { keyId, dealerId: record.dealer_id };
}
