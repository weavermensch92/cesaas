/**
 * 인증 4종 매트릭스 — C_04_인증.md.
 *
 *   HMAC + API key  → Extension  (hmac.ts)
 *   Bearer JWT      → Dealer     (이 파일)
 *   Anonymous       → Visitor    (이 파일)
 *   Supabase Auth   → Admin      (이 파일)
 */

import { jwtVerify } from 'jose';
import { ApiError } from './errors.js';

// ---------------------------------------------------------------------------
// Dealer — Bearer JWT
// ---------------------------------------------------------------------------

export interface DealerIdentity {
  sub: string;
  role: 'dealer';
  event: string;
  exp: number;
}

export interface BearerConfig {
  secret: string;
  issuer?: string;
  /** 토큰의 event 클레임이 이 값과 일치해야 함. 미지정 시 검증 X. */
  expectedEvent?: string;
}

export async function verifyBearer(
  req: Request,
  cfg: BearerConfig,
): Promise<DealerIdentity> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw new ApiError('invalid_token', 'missing Bearer token');
  }
  const token = auth.slice(7);
  const enc = new TextEncoder().encode(cfg.secret);
  try {
    const { payload } = await jwtVerify(token, enc, {
      issuer: cfg.issuer,
    });
    if (payload.role !== 'dealer') {
      throw new ApiError('forbidden', 'role is not dealer', { role: payload.role });
    }
    if (cfg.expectedEvent && payload.event !== cfg.expectedEvent) {
      throw new ApiError('forbidden', 'event mismatch', {
        event: payload.event,
        expected: cfg.expectedEvent,
      });
    }
    return {
      sub: String(payload.sub),
      role: 'dealer',
      event: String(payload.event),
      exp: Number(payload.exp ?? 0),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('invalid_token', 'JWT verification failed', {
      reason: err instanceof Error ? err.message : 'unknown',
    });
  }
}

// ---------------------------------------------------------------------------
// Visitor — Anonymous (device_id)
// ---------------------------------------------------------------------------

const DEVICE_ID_RE = /^[0-9a-f-]{16,64}$/i;

export function extractDeviceId(req: Request): string {
  const id = req.headers.get('x-device-id') ?? '';
  if (!DEVICE_ID_RE.test(id)) {
    throw new ApiError('unauthorized', 'X-Device-ID missing or invalid');
  }
  return id;
}

// ---------------------------------------------------------------------------
// Admin — Supabase Auth (JWT의 role + email 도메인)
// ---------------------------------------------------------------------------

export interface AdminIdentity {
  sub: string;
  email: string;
  role: 'hd_admin' | 'gridge_admin';
}

export interface AdminConfig {
  /** Supabase JWT secret */
  jwtSecret: string;
  /** 허용 이메일 도메인. "hyundai" 표기 금지 — HD 도메인 표기 사용 */
  allowedDomains: string[];
}

export async function requireAdmin(req: Request, cfg: AdminConfig): Promise<AdminIdentity> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw new ApiError('unauthorized', 'missing Supabase Bearer token');
  }
  const token = auth.slice(7);
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(cfg.jwtSecret));
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw new ApiError('invalid_token', 'Supabase JWT verification failed', {
      reason: err instanceof Error ? err.message : 'unknown',
    });
  }

  const email = String(payload.email ?? '');
  if (!email) throw new ApiError('forbidden', 'email claim missing');

  const at = email.lastIndexOf('@');
  const domain = at >= 0 ? email.slice(at + 1).toLowerCase() : '';
  if (!cfg.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
    throw new ApiError('forbidden', 'email domain not allowed', { domain });
  }

  // role 클레임 우선, 없으면 도메인으로 추정.
  let role: AdminIdentity['role'];
  const claimRole = String(payload.role ?? '');
  if (claimRole === 'hd_admin' || claimRole === 'gridge_admin') {
    role = claimRole;
  } else if (domain === 'gridge.co.kr') {
    role = 'gridge_admin';
  } else {
    role = 'hd_admin';
  }

  return { sub: String(payload.sub ?? ''), email, role };
}
