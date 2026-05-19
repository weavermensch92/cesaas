/**
 * GET /auth-me  → { sub, email, role, password_set }
 * serves: ['super_admin','admin','regular']
 * 모든 로그인 사용자 — AuthGate 가 호출해 라우팅·네비 결정.
 */
import { requireUser } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/auth-me' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    const u = await requireUser(req);
    // last_login 갱신 (best effort)
    db().rpc('touch_last_login', { p_user_id: u.sub }).then(() => {}, () => {});
    return jsonResponse(200, u, log.requestId);
  } catch (err) {
    log.error('auth-me failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
