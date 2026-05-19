/**
 * POST /auth-mark-password-set  — 본인이 비번 설정 완료 직후 호출
 *   (프론트가 supabase.auth.updateUser({password}) 성공 후)
 * 모든 로그인 사용자.
 */
import { requireUser } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/auth-mark-password-set' });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const u = await requireUser(req);
    const { error } = await db().rpc('mark_password_set', { p_user_id: u.sub });
    if (error) throw new ApiError('internal_error', 'mark failed', { db: error.message });
    log.info('password_set=true', { actor: u.email });
    return jsonResponse(200, { status: 'ok' }, log.requestId);
  } catch (err) {
    log.error('auth-mark-password-set failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
