// Deno 미러: @hd/core/errors. 동일 포맷 — C_03_API_패턴 § 2.
// Node 측 @hd/core와 동기 유지 필요.

export type ApiErrorCode =
  | 'bad_request' | 'invalid_signature' | 'invalid_token' | 'unauthorized'
  | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited'
  | 'idempotency_mismatch' | 'validation_failed' | 'payload_too_large'
  | 'internal_error' | 'upstream_unavailable' | 'llm_rate_limited' | 'llm_failed'
  | 'config_missing';

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400, invalid_signature: 401, invalid_token: 401, unauthorized: 401,
  forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429,
  idempotency_mismatch: 409, validation_failed: 422, payload_too_large: 413,
  internal_error: 500, upstream_unavailable: 503, llm_rate_limited: 429, llm_failed: 502,
  config_missing: 503,
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

// ─── CORS ───────────────────────────────────────────────────────────────────
// Authorization Bearer 사용 + 쿠키 미사용 → `*` 허용 OK.
// Sensor HMAC 헤더·idempotency 헤더 화이트리스트 포함.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, x-request-id, idempotency-key, ' +
    'x-sensor-key-id, x-sensor-signature, x-sensor-timestamp, x-sensor-nonce, x-client-info, apikey',
  'access-control-max-age': '86400',
};

/** OPTIONS 프리플라이트면 204 + CORS 응답, 아니면 null. Deno.serve 진입 직후 호출. */
export function corsPreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

function buildHeaders(requestId?: string): HeadersInit {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    ...CORS_HEADERS,
  };
  if (requestId) h['x-request-id'] = requestId;
  return h;
}

export function toJsonResponse(err: unknown, requestId?: string): Response {
  const e = err instanceof ApiError
    ? err
    : err instanceof Error
      ? new ApiError('internal_error', err.message)
      : new ApiError('internal_error', 'Unknown error');
  return new Response(JSON.stringify(e.toBody()), { status: e.status, headers: buildHeaders(requestId) });
}

export function jsonResponse(status: number, body: unknown, requestId?: string): Response {
  return new Response(JSON.stringify(body), { status, headers: buildHeaders(requestId) });
}
