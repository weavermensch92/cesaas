/**
 * Cursor pagination — C_03_API_패턴.md § 3.
 * 커서 = base64(created_at + id). created_at 동률은 id로 보조 정렬.
 */

import { ApiError } from './errors.js';

export interface CursorPayload {
  /** ISO-8601 timestamp */
  t: string;
  /** UUID 등 보조 정렬 키 */
  i: string;
}

export interface PaginatedResult<T> {
  data: T[];
  next_cursor: string | null;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function b64encode(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  // Deno/Edge
  return btoa(unescape(encodeURIComponent(s)));
}

function b64decode(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
  return decodeURIComponent(escape(atob(s)));
}

export function encodeCursor(payload: CursorPayload): string {
  return b64encode(JSON.stringify(payload));
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const obj = JSON.parse(b64decode(cursor)) as Partial<CursorPayload>;
    if (typeof obj.t !== 'string' || typeof obj.i !== 'string') {
      throw new Error('missing t or i');
    }
    return { t: obj.t, i: obj.i };
  } catch (err) {
    throw new ApiError('bad_request', 'invalid cursor', {
      cursor,
      reason: err instanceof Error ? err.message : 'parse failed',
    });
  }
}

export function parseLimit(raw: string | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError('bad_request', 'limit must be a positive integer', { raw });
  }
  return Math.min(n, MAX_LIMIT);
}

/**
 * 결과 row가 limit + 1 개 들어왔을 때 마지막 row를 다음 커서로 사용.
 * row는 created_at·id 컬럼을 가져야 함.
 */
export function buildPage<T extends { created_at: string | Date; id: string }>(
  rows: T[],
  limit: number,
): PaginatedResult<T> {
  if (rows.length <= limit) return { data: rows, next_cursor: null };
  const cutoff = rows[limit - 1];
  if (!cutoff) return { data: rows.slice(0, limit), next_cursor: null };
  const ts = cutoff.created_at instanceof Date
    ? cutoff.created_at.toISOString()
    : cutoff.created_at;
  return {
    data: rows.slice(0, limit),
    next_cursor: encodeCursor({ t: ts, i: cutoff.id }),
  };
}
