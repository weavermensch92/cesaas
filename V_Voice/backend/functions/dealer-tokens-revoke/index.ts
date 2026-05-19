/**
 * PATCH /dealer-tokens-revoke — Admin → 발급된 딜러 토큰 revoke (V_30.04).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * Body:
 *   { jti: string, reason?: string }
 *
 * revoke 후에도 JWT 자체는 검증 통과할 수 있으나, voice_dealer_tokens row의
 * revoked_at 으로 인해 bearer.ts 가 식별 — 정확한 차단은 거기서 jti lookup 추가 필요.
 * (현 단계에서는 row 마킹 + Admin UI 노출로 운영 가시화)
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/dealer-tokens-revoke';

const JTI_RE = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'PATCH') throw new ApiError('bad_request', 'PATCH only');
    const admin = await requireAdmin(req);

    let raw: unknown;
    try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'invalid JSON'); }
    if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
    const b = raw as Record<string, unknown>;
    const jti = String(b.jti ?? '').trim();
    if (!JTI_RE.test(jti)) throw new ApiError('validation_failed', 'jti format', { jti });

    const { data, error } = await db()
      .from('voice_dealer_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('jti', jti)
      .is('revoked_at', null)
      .select('id, dealer_id, event, jti, revoked_at')
      .maybeSingle();
    if (error) throw new ApiError('internal_error', 'revoke failed', { db: error.message });
    if (!data) throw new ApiError('not_found', 'token not found or already revoked', { jti });

    log.info('dealer token revoked', { jti, by: admin.email });
    return jsonResponse(200, { ...data, revoked_by: admin.email }, log.requestId);
  } catch (err) {
    log.error('dealer-tokens-revoke failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
