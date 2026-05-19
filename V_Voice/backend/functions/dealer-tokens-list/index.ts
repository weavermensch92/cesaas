/**
 * GET /dealer-tokens-list — Admin → 발급된 딜러 토큰 목록 + 응답 카운트 (V_30.04).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * Query:
 *   event             단일 값 (선택)
 *   include_revoked   'true' → revoke 포함 (기본 false)
 *   include_expired   'true' → 만료 포함 (기본 false)
 *   limit (1~200, 기본 100) · cursor
 *
 * 응답 row에 `response_count` (해당 dealer_id + event 의 responses 총수) 동봉.
 * URL/JWT는 발급 시점에만 회수 가능 — 목록에는 노출 안함.
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { buildPage, decodeCursor, parseLimit } from 'shared/pagination.ts';

const ROUTE = '/dealer-tokens-list';

interface TokenRow {
  id: string;
  dealer_id: string;
  event: string;
  jti: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  label: string | null;
  issued_by: string | null;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const p = url.searchParams;
    const limit = parseLimit(p.get('limit'));
    const includeRevoked = p.get('include_revoked') === 'true';
    const includeExpired = p.get('include_expired') === 'true';
    const event = p.get('event');

    let q = db()
      .from('voice_dealer_tokens')
      .select('id, dealer_id, event, jti, issued_at, expires_at, revoked_at, label, issued_by');

    if (event) q = q.eq('event', event);
    if (!includeRevoked) q = q.is('revoked_at', null);
    if (!includeExpired) q = q.gt('expires_at', new Date().toISOString());

    const cursor = p.get('cursor');
    if (cursor) {
      const { t, i } = decodeCursor(cursor);
      q = q.or(`issued_at.lt.${t},and(issued_at.eq.${t},id.lt.${i})`);
    }

    q = q.order('issued_at', { ascending: false })
         .order('id', { ascending: false })
         .limit(limit + 1);

    const { data, error } = await q;
    if (error) throw new ApiError('internal_error', 'tokens query failed', { db: error.message });

    const rows = (data ?? []) as TokenRow[];

    // 딜러별 응답 카운트 — (dealer_id, event) 묶음.
    const keys = Array.from(new Set(rows.map((r) => `${r.dealer_id}|${r.event}`)));
    const counts = new Map<string, number>();
    if (keys.length > 0) {
      const dealers = Array.from(new Set(rows.map((r) => r.dealer_id)));
      const events = Array.from(new Set(rows.map((r) => r.event)));
      const { data: respRows, error: rErr } = await db()
        .from('responses')
        .select('dealer_id, event')
        .in('dealer_id', dealers)
        .in('event', events)
        .limit(10000);
      if (rErr) {
        log.warn('response count failed', { db: rErr.message });
      } else {
        for (const r of (respRows ?? []) as { dealer_id: string; event: string }[]) {
          const k = `${r.dealer_id}|${r.event}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      response_count: counts.get(`${r.dealer_id}|${r.event}`) ?? 0,
    }));

    return jsonResponse(200, buildPage(enriched, limit, 'issued_at'), log.requestId);
  } catch (err) {
    log.error('dealer-tokens-list failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
