/**
 * /admin-members  — 회원 관리 (super_admin · admin).
 *
 *   GET    → 목록
 *   POST   { email, role }              → inviteUserByEmail + register_invited_user
 *   PATCH  { user_id, role }            → set_user_role
 *
 * Magic link 는 Supabase Auth 가 invite 메일로 자동 발송.
 * 사용자는 링크 클릭 → 자동 로그인 → /set-password 강제 (password_set=false).
 */
import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { envOptional } from 'shared/env.ts';
import { requestLogger } from 'shared/logger.ts';

type Role = 'super_admin' | 'admin' | 'regular';
function isRole(s: unknown): s is Role { return s === 'super_admin' || s === 'admin' || s === 'regular'; }

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/admin-members' });
  try {
    const admin = await requireAdmin(req);

    if (req.method === 'GET') {
      const { data, error } = await db().rpc('list_user_profiles');
      if (error) throw new ApiError('internal_error', 'list failed', { db: error.message });
      return jsonResponse(200, { data: data ?? [] }, log.requestId);
    }

    if (req.method === 'POST') {
      const body = await safeJson(req);
      const email = String(body?.email ?? '').trim().toLowerCase();
      const role = body?.role;
      if (!email || !email.includes('@')) {
        throw new ApiError('validation_failed', 'email required');
      }
      if (!isRole(role)) throw new ApiError('validation_failed', 'role required (super_admin|admin|regular)');

      const redirectBase = envOptional('PUBLIC_SITE_URL', 'https://hd-poc-admin.fly.dev');
      const redirectTo = `${redirectBase}/set-password`;

      // Supabase Auth Admin API — invite + magic link
      const { data: invited, error: invErr } = await db().auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });
      if (invErr || !invited?.user) {
        // 이미 존재하는 사용자면 user_profiles 만 처리
        if ((invErr?.message ?? '').includes('already')) {
          // 기존 user 조회
          const { data: list } = await db().auth.admin.listUsers({ page: 1, perPage: 200 });
          const existing = list?.users?.find((u) => (u.email ?? '').toLowerCase() === email);
          if (!existing) throw new ApiError('conflict', 'user already exists but lookup failed');
          const { data: prof, error: regErr } = await db().rpc('register_invited_user', {
            p_user_id: existing.id, p_role: role, p_invited_by: admin.sub,
          });
          if (regErr) throw new ApiError('internal_error', 'register failed', { db: regErr.message });
          // 재초대 (매직 링크 재발송)
          await db().auth.admin.generateLink({
            type: 'magiclink', email, options: { redirectTo },
          });
          log.info('re-invited existing user', { actor: admin.email, target: email, role });
          return jsonResponse(200, { status: 're_invited', profile: prof }, log.requestId);
        }
        throw new ApiError('internal_error', 'invite failed', { reason: invErr?.message });
      }

      const { data: prof, error: regErr } = await db().rpc('register_invited_user', {
        p_user_id: invited.user.id, p_role: role, p_invited_by: admin.sub,
      });
      if (regErr) throw new ApiError('internal_error', 'register failed', { db: regErr.message });
      log.info('invited new user', { actor: admin.email, target: email, role });
      return jsonResponse(200, { status: 'invited', profile: prof }, log.requestId);
    }

    if (req.method === 'PATCH') {
      const body = await safeJson(req);
      const userId = String(body?.user_id ?? '');
      const role = body?.role;
      if (!userId) throw new ApiError('validation_failed', 'user_id required');
      if (!isRole(role)) throw new ApiError('validation_failed', 'role required');
      const { data, error } = await db().rpc('set_user_role', {
        p_user_id: userId, p_role: role, p_actor: admin.sub,
      });
      if (error) {
        if (error.code === '23514') throw new ApiError('conflict', error.message);
        if (error.code === 'P0002') throw new ApiError('not_found', error.message);
        throw new ApiError('internal_error', 'set_user_role failed', { db: error.message });
      }
      log.info('role updated', { actor: admin.email, target_id: userId, role });
      return jsonResponse(200, { profile: data }, log.requestId);
    }

    throw new ApiError('bad_request', 'GET / POST / PATCH only');
  } catch (err) {
    log.error('admin-members failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return await req.json() as Record<string, unknown>; } catch { return null; }
}
