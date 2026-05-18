// Admin 인증 — Supabase Auth bearer 토큰을 service-role client.auth.getUser로 검증.
// 도메인 화이트리스트 → role 매핑. C_04_인증 § 5.

import { db } from './db.ts';
import { ApiError } from './errors.ts';
import { envOptional } from './env.ts';

export interface AdminIdentity {
  sub: string;
  email: string;
  role: 'hd_admin' | 'gridge_admin';
}

function parseDomains(): string[] {
  const raw = envOptional('ADMIN_EMAIL_DOMAINS', '');
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const GRIDGE_DOMAINS = ['gridge.co.kr'];

export async function requireAdmin(req: Request): Promise<AdminIdentity> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw new ApiError('unauthorized', 'missing Supabase Bearer token');
  }
  const token = auth.slice(7);

  const { data, error } = await db().auth.getUser(token);
  if (error || !data?.user) {
    throw new ApiError('invalid_token', 'Supabase auth.getUser failed', {
      reason: error?.message ?? 'no user',
    });
  }

  const email = (data.user.email ?? '').toLowerCase();
  if (!email) throw new ApiError('forbidden', 'email missing on user');

  const at = email.lastIndexOf('@');
  const domain = at >= 0 ? email.slice(at + 1) : '';

  const allowedDomains = parseDomains();
  if (allowedDomains.length && !allowedDomains.includes(domain)) {
    throw new ApiError('forbidden', 'email domain not allowed', { domain });
  }

  // role: JWT claim 우선, 없으면 도메인 추정.
  const claimRole = String(data.user.user_metadata?.role ?? '');
  let role: AdminIdentity['role'];
  if (claimRole === 'hd_admin' || claimRole === 'gridge_admin') {
    role = claimRole;
  } else if (GRIDGE_DOMAINS.includes(domain)) {
    role = 'gridge_admin';
  } else {
    role = 'hd_admin';
  }

  return { sub: data.user.id, email, role };
}
