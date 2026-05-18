/**
 * API 공통 에러 포맷 — C_03_API_패턴.md § 2.
 * 모든 /v1 핸들러는 ApiError를 throw, 라우터에서 toJsonResponse 처리.
 */

export type ApiErrorCode =
  // 4xx
  | 'bad_request'
  | 'invalid_signature'
  | 'invalid_token'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'idempotency_mismatch'
  | 'validation_failed'
  | 'payload_too_large'
  // 5xx
  | 'internal_error'
  | 'upstream_unavailable'
  | 'llm_rate_limited'
  | 'llm_failed';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  invalid_signature: 401,
  invalid_token: 401,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  idempotency_mismatch: 409,
  validation_failed: 422,
  payload_too_large: 413,
  internal_error: 500,
  upstream_unavailable: 503,
  llm_rate_limited: 429,
  llm_failed: 502,
};

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly details: Record<string, unknown> | undefined;
  public readonly status: number;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = STATUS_BY_CODE[code];
  }

  toBody(): ApiErrorBody {
    return this.details === undefined
      ? { error: this.code, message: this.message }
      : { error: this.code, message: this.message, details: this.details };
  }
}

/**
 * 알 수 없는 throw 값을 ApiError로 정규화.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof Error) {
    return new ApiError('internal_error', err.message, { name: err.name });
  }
  return new ApiError('internal_error', 'Unknown error', { value: String(err) });
}

/**
 * Fetch Response 변환 헬퍼 — Edge Function용.
 */
export function toJsonResponse(err: unknown, headers: HeadersInit = {}): Response {
  const e = toApiError(err);
  return new Response(JSON.stringify(e.toBody()), {
    status: e.status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
