// Deno 미러: @hd/core/idempotency. C_03_API_패턴 § 4.
import { db } from './db.ts';
import { ApiError } from './errors.ts';

const TABLE = 'processed_events';

export interface IdempotencyHit {
  hit: true;
  status: number;
  body: unknown;
}
export interface IdempotencyMiss { hit: false }
export type IdempotencyLookup = IdempotencyHit | IdempotencyMiss;

export async function lookupIdempotency(args: {
  key: string;
  route: string;
  requestHash: string;
}): Promise<IdempotencyLookup> {
  const { data, error } = await db()
    .from(TABLE)
    .select('idempotency_key, route, request_hash, response_status, response_body, expires_at')
    .eq('idempotency_key', args.key)
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'idempotency lookup failed', { db: error.message });
  if (!data) return { hit: false };
  if (new Date(data.expires_at as string) < new Date()) return { hit: false };
  if (data.route !== args.route || data.request_hash !== args.requestHash) {
    throw new ApiError('idempotency_mismatch', 'Idempotency-Key reused with different payload', {
      key: args.key, stored_route: data.route,
    });
  }
  return { hit: true, status: data.response_status as number, body: data.response_body };
}

export async function recordIdempotency(args: {
  key: string;
  route: string;
  requestHash: string;
  status: number;
  body: unknown;
}): Promise<void> {
  const { error } = await db().from(TABLE).insert({
    idempotency_key: args.key,
    route: args.route,
    request_hash: args.requestHash,
    response_status: args.status,
    response_body: args.body,
  });
  if (error && error.code !== '23505') {
    throw new ApiError('internal_error', 'idempotency record failed', { db: error.message });
  }
}
