/**
 * HMAC + API key — C_04_인증.md § 2.
 * Sensor Extension 송출에서 사용.
 * 서명 payload: `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors.js';

const TIMESTAMP_DRIFT_SECONDS = 300;

export interface HmacHeaders {
  authorization: string; // "HMAC {key_id}:{signature}"
  timestamp: string;     // X-Timestamp (epoch seconds)
  nonce: string;         // X-Nonce
}

export interface HmacVerifiedIdentity {
  keyId: string;
  /** key_id로 매핑된 dealer_id (없으면 글로벌 키) */
  dealerId: string | null;
}

interface KeyRecord {
  key_id: string;
  secret: string;     // base64 or hex — 환경변수에서 직접 매핑
  dealer_id: string | null;
  revoked_at: string | null;
}

export interface HmacVerifierDeps {
  /** key_id로 시크릿을 가져오는 함수 — env 또는 DB 위에 구현 */
  loadKey: (keyId: string) => Promise<KeyRecord | null>;
  /** nonce 1회용 보장 store — Supabase hmac_nonces 권장 */
  db: SupabaseClient;
  /** 현재 시각 주입 (테스트용) */
  now?: () => number;
}

export function extractHmacHeaders(req: Request): HmacHeaders {
  const authorization = req.headers.get('authorization') ?? '';
  const timestamp = req.headers.get('x-timestamp') ?? '';
  const nonce = req.headers.get('x-nonce') ?? '';
  if (!authorization.startsWith('HMAC ') || !timestamp || !nonce) {
    throw new ApiError('invalid_signature', 'HMAC headers missing or malformed');
  }
  return { authorization, timestamp, nonce };
}

async function computeSignature(
  secret: string,
  payload: string,
): Promise<string> {
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

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * 요청 검증 — drift + nonce + signature 3중 체크.
 */
export async function verifyHmac(
  req: Request,
  bodyHashHex: string,
  deps: HmacVerifierDeps,
): Promise<HmacVerifiedIdentity> {
  const headers = extractHmacHeaders(req);
  const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_DRIFT_SECONDS) {
    throw new ApiError('invalid_signature', 'timestamp drift exceeds 300s', {
      drift_seconds: now - ts,
    });
  }

  const sep = headers.authorization.indexOf(':');
  if (sep < 0) throw new ApiError('invalid_signature', 'malformed Authorization');
  const keyId = headers.authorization.slice(5, sep);
  const sig = headers.authorization.slice(sep + 1);

  const record = await deps.loadKey(keyId);
  if (!record || record.revoked_at) {
    throw new ApiError('invalid_signature', 'unknown or revoked key_id', { key_id: keyId });
  }

  const url = new URL(req.url);
  const payload = `${req.method}\n${url.pathname}\n${headers.timestamp}\n${headers.nonce}\n${bodyHashHex}`;
  const expected = await computeSignature(record.secret, payload);
  if (!constantTimeEquals(sig, expected)) {
    throw new ApiError('invalid_signature', 'signature mismatch');
  }

  // nonce 1회용 보장 — unique violation = 재사용
  const { error } = await deps.db
    .from('hmac_nonces')
    .insert({ key_id: keyId, nonce: headers.nonce });
  if (error) {
    if (error.code === '23505') {
      throw new ApiError('invalid_signature', 'nonce already used', { nonce: headers.nonce });
    }
    throw new ApiError('internal_error', 'nonce store failed', { db: error.message });
  }

  return { keyId, dealerId: record.dealer_id };
}
