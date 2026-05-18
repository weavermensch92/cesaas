// Deno 미러: @hd/core/errors. 동일 포맷 — C_03_API_패턴 § 2.
// Node 측 @hd/core와 동기 유지 필요.

export type ApiErrorCode =
  | 'bad_request' | 'invalid_signature' | 'invalid_token' | 'unauthorized'
  | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited'
  | 'idempotency_mismatch' | 'validation_failed' | 'payload_too_large'
  | 'internal_error' | 'upstream_unavailable' | 'llm_rate_limited' | 'llm_failed';

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400, invalid_signature: 401, invalid_token: 401, unauthorized: 401,
  forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429,
  idempotency_mismatch: 409, validation_failed: 422, payload_too_large: 413,
  internal_error: 500, upstream_unavailable: 503, llm_rate_limited: 429, llm_failed: 502,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
  toBody(): Record<string, unknown> {
    return this.details === undefined
      ? { error: this.code, message: this.message }
      : { error: this.code, message: this.message, details: this.details };
  }
}

export function toJsonResponse(err: unknown, requestId?: string): Response {
  const e = err instanceof ApiError
    ? err
    : err instanceof Error
      ? new ApiError('internal_error', err.message)
      : new ApiError('internal_error', 'Unknown error');
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (requestId) (headers as Record<string, string>)['x-request-id'] = requestId;
  return new Response(JSON.stringify(e.toBody()), { status: e.status, headers });
}

export function jsonResponse(status: number, body: unknown, requestId?: string): Response {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (requestId) (headers as Record<string, string>)['x-request-id'] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}
