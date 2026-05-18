/**
 * Idempotency-Key 처리 — C_03_API_패턴.md § 4.
 * processed_events 테이블을 Supabase service role로 직접 조회·삽입.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors.js';

const TABLE = 'processed_events';

export interface IdempotencyHit {
  hit: true;
  status: number;
  body: unknown;
}
export interface IdempotencyMiss {
  hit: false;
}
export type IdempotencyLookup = IdempotencyHit | IdempotencyMiss;

/**
 * 들어온 키가 24h 내 이미 처리됐는지 확인.
 * 같은 키 + 다른 request_hash → idempotency_mismatch (409).
 */
export async function lookupIdempotency(
  db: SupabaseClient,
  args: { key: string; route: string; requestHash: string },
): Promise<IdempotencyLookup> {
  const { data, error } = await db
    .from(TABLE)
    .select('idempotency_key, route, request_hash, response_status, response_body, expires_at')
    .eq('idempotency_key', args.key)
    .maybeSingle();

  if (error) throw new ApiError('internal_error', 'idempotency lookup failed', { db: error.message });
  if (!data) return { hit: false };

  if (new Date(data.expires_at as string) < new Date()) return { hit: false };

  if (data.route !== args.route || data.request_hash !== args.requestHash) {
    throw new ApiError('idempotency_mismatch', 'Idempotency-Key reused with different payload', {
      key: args.key,
      stored_route: data.route,
    });
  }

  return {
    hit: true,
    status: data.response_status as number,
    body: data.response_body,
  };
}

export async function recordIdempotency(
  db: SupabaseClient,
  args: { key: string; route: string; requestHash: string; status: number; body: unknown },
): Promise<void> {
  const { error } = await db.from(TABLE).insert({
    idempotency_key: args.key,
    route: args.route,
    request_hash: args.requestHash,
    response_status: args.status,
    response_body: args.body,
  });
  // 동시 중복 INSERT(unique violation)는 무시 — 다른 워커가 먼저 기록한 것.
  if (error && error.code !== '23505') {
    throw new ApiError('internal_error', 'idempotency record failed', { db: error.message });
  }
}

/**
 * 요청 본문 SHA-256 hex 다이제스트.
 */
export async function hashRequestBody(bytes: Uint8Array | string): Promise<string> {
  const buf = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
