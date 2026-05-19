// Dealer Bearer JWT 검증 — C_04_인증 § 3.
// JWT payload 예: { sub: dealer_001, role: 'dealer', event: 'ctt_moscow_2026', exp, iat }

import { jwtVerify } from 'jose';
import { ApiError } from './errors.ts';
import { envRequired, envOptional } from './env.ts';
import { db } from './db.ts';

export interface DealerIdentity {
  sub: string;
  role: 'dealer';
  event: string;
  exp: number;
  jti: string;
}

export interface AnonymousIdentity {
  device_id: string;
  role: 'visitor';
}

export type RespondentIdentity = DealerIdentity | AnonymousIdentity;

const DEVICE_ID_RE = /^[0-9a-f-]{16,64}$/i;

export async function verifyDealerBearer(req: Request): Promise<DealerIdentity> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw new ApiError('invalid_token', 'missing Bearer token');
  }
  const token = auth.slice(7);
  const secret = envRequired('VOICE_JWT_SECRET');
  const issuer = envOptional('VOICE_JWT_ISSUER', 'hd-poc');
  const expectedEvent = envOptional('VOICE_JWT_EVENT', '');

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: issuer || undefined,
    });
    if (payload.role !== 'dealer') {
      throw new ApiError('forbidden', 'role is not dealer', { role: payload.role });
    }
    if (expectedEvent && payload.event !== expectedEvent) {
      throw new ApiError('forbidden', 'event mismatch', {
        event: payload.event, expected: expectedEvent,
      });
    }
    const jti = String(payload.jti ?? '');
    if (!jti) throw new ApiError('invalid_token', 'jti missing');

    // revoke 체크 — voice_dealer_tokens.revoked_at IS NOT NULL 이면 차단.
    // row 누락(legacy)은 통과(JWT 자체가 유효하면 신뢰).
    const { data: tokenRow, error: tErr } = await db()
      .from('voice_dealer_tokens')
      .select('revoked_at')
      .eq('jti', jti)
      .maybeSingle();
    if (tErr) {
      // DB 조회 실패는 fail-open 대신 fail-closed (보안 우선).
      throw new ApiError('internal_error', 'token lookup failed', { db: tErr.message });
    }
    if (tokenRow?.revoked_at) {
      throw new ApiError('forbidden', 'token revoked', { jti, revoked_at: tokenRow.revoked_at });
    }

    return {
      sub: String(payload.sub),
      role: 'dealer',
      event: String(payload.event ?? expectedEvent),
      exp: Number(payload.exp ?? 0),
      jti,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('invalid_token', 'JWT verification failed', {
      reason: err instanceof Error ? err.message : 'unknown',
    });
  }
}

export function extractDeviceId(req: Request): string {
  const id = req.headers.get('x-device-id') ?? '';
  if (!DEVICE_ID_RE.test(id)) {
    throw new ApiError('unauthorized', 'X-Device-ID missing or invalid');
  }
  return id;
}

/**
 * Bearer 있으면 Dealer, X-Device-ID 있으면 Visitor, 둘 다 아니면 401.
 */
export async function resolveRespondent(req: Request): Promise<RespondentIdentity> {
  const hasBearer = (req.headers.get('authorization') ?? '').startsWith('Bearer ');
  if (hasBearer) return verifyDealerBearer(req);
  if (req.headers.get('x-device-id')) {
    return { device_id: extractDeviceId(req), role: 'visitor' };
  }
  throw new ApiError('unauthorized', 'no Bearer or X-Device-ID');
}
