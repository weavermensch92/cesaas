// 회원 등급 검증 — user_profiles 테이블 기반 (014_user_profiles).
// role: 'super_admin' | 'admin' | 'regular'.
// super_admin == admin (Edge Function 권한 동일). regular 는 관리자 함수 호출 금지.

import { db } from './db.ts';
import { ApiError } from './errors.ts';

export type UserRole = 'super_admin' | 'admin' | 'regular';

export interface UserIdentity {
  sub: string;          // auth.users.id
  email: string;
  role: UserRole;
  password_set: boolean;
}

// 하위 호환 — 기존 코드(admin-captures 등)는 AdminIdentity 사용.
export interface AdminIdentity {
  sub: string;
  email: string;
  role: 'super_admin' | 'admin';
}

async function loadIdentity(req: Request): Promise<UserIdentity> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw new ApiError('unauthorized', 'missing Supabase Bearer token');
  }
  const token = auth.slice(7);

  const { data: u, error: uErr } = await db().auth.getUser(token);
  if (uErr || !u?.user) {
    throw new ApiError('invalid_token', 'Supabase auth.getUser failed', { reason: uErr?.message ?? 'no user' });
  }
  const email = (u.user.email ?? '').toLowerCase();
  if (!email) throw new ApiError('forbidden', 'email missing on user');

  const { data: p, error: pErr } = await db().rpc('get_user_profile_for', { p_user_id: u.user.id });
  if (pErr) {
    throw new ApiError('internal_error', 'profile lookup failed', { reason: pErr.message });
  }
  const row = Array.isArray(p) ? p[0] : p;
  if (!row) {
    // 트리거가 user_profiles 행을 만들지만, 만약 누락이면 regular 로 fallback.
    return { sub: u.user.id, email, role: 'regular', password_set: false };
  }
  return {
    sub: u.user.id,
    email,
    role: (row.role ?? 'regular') as UserRole,
    password_set: Boolean(row.password_set),
  };
}

/** 모든 로그인 사용자. /me, /set-password 등에서 사용. */
export async function requireUser(req: Request): Promise<UserIdentity> {
  return loadIdentity(req);
}

/** admin · super_admin 만. regular 차단. */
export async function requireAdmin(req: Request): Promise<AdminIdentity> {
  const u = await loadIdentity(req);
  if (u.role !== 'admin' && u.role !== 'super_admin') {
    throw new ApiError('forbidden', 'admin role required', { role: u.role });
  }
  return { sub: u.sub, email: u.email, role: u.role };
}

/** super_admin 만. (현재 admin 과 동일 권한이지만 슈퍼 전용 확장 여지) */
export async function requireSuperAdmin(req: Request): Promise<AdminIdentity> {
  const u = await loadIdentity(req);
  if (u.role !== 'super_admin') {
    throw new ApiError('forbidden', 'super_admin role required', { role: u.role });
  }
  return { sub: u.sub, email: u.email, role: u.role };
}
