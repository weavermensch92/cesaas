// Cursor pagination — C_03_API_패턴 § 3. Deno 미러: @hd/core/pagination.
import { ApiError } from './errors.ts';

export interface CursorPayload { t: string; i: string }

export interface PaginatedResult<T> {
  data: T[];
  next_cursor: string | null;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function encodeCursor(p: CursorPayload): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(p))));
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(cursor)))) as Partial<CursorPayload>;
    if (typeof obj.t !== 'string' || typeof obj.i !== 'string') throw new Error('missing t or i');
    return { t: obj.t, i: obj.i };
  } catch (e) {
    throw new ApiError('bad_request', 'invalid cursor', {
      reason: e instanceof Error ? e.message : 'parse failed',
    });
  }
}

export function parseLimit(raw: string | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError('bad_request', 'limit must be positive integer', { raw });
  }
  return Math.min(n, MAX_LIMIT);
}

export function buildPage<T extends { id: string } & Record<string, unknown>>(
  rows: T[],
  limit: number,
  tsKey: string = 'created_at',
): PaginatedResult<T> {
  if (rows.length <= limit) return { data: rows, next_cursor: null };
  const cutoff = rows[limit - 1];
  if (!cutoff) return { data: rows.slice(0, limit), next_cursor: null };
  const v = cutoff[tsKey];
  const ts = v instanceof Date ? v.toISOString() : String(v);
  return {
    data: rows.slice(0, limit),
    next_cursor: encodeCursor({ t: ts, i: cutoff.id }),
  };
}
