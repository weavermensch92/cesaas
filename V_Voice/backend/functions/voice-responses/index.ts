/**
 * GET /voice-responses — Voice 응답 목록 (V_30.01).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * Query:
 *   respondent_type   'dealer' | 'visitor'
 *   segment           콤마 구분 (mining,key_account,...)
 *   event             단일 값
 *   from, to          ISO 8601 (captured_at)
 *   nps_min, nps_max  0~10 정수
 *   contact_opted_in  'true' | 'false'
 *   dealer_id         단일 값 (정확 매칭)
 *   target_company    부분 일치 (ilike, %-자동 wrapping)
 *   limit (1~200, 기본 50) · cursor
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { buildPage, decodeCursor, parseLimit } from 'shared/pagination.ts';

const ROUTE = '/voice-responses';

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const p = url.searchParams;
    const limit = parseLimit(p.get('limit'));

    let q = db()
      .from('responses')
      .select(
        'id, created_at, captured_at, respondent_type, dealer_id, device_id, ' +
        'event, language, nps, segment, segment_confidence, segment_method, ' +
        'future_subscription, consent_data_collection, contact_opted_in, ' +
        'contact_name, contact_phone, contact_email, axis_data, pii_redacted_at, ' +
        'target_company, notes'
      );

    const rt = p.get('respondent_type');
    if (rt === 'dealer' || rt === 'visitor') q = q.eq('respondent_type', rt);

    const segs = p.get('segment');
    if (segs) q = q.in('segment', segs.split(',').map((s) => s.trim()).filter(Boolean));

    const event = p.get('event');
    if (event) q = q.eq('event', event);

    const from = p.get('from');
    if (from) q = q.gte('captured_at', from);
    const to = p.get('to');
    if (to) q = q.lte('captured_at', to);

    const npsMin = p.get('nps_min');
    if (npsMin !== null && npsMin !== '') q = q.gte('nps', Number(npsMin));
    const npsMax = p.get('nps_max');
    if (npsMax !== null && npsMax !== '') q = q.lte('nps', Number(npsMax));

    const optIn = p.get('contact_opted_in');
    if (optIn === 'true')  q = q.eq('contact_opted_in', true);
    if (optIn === 'false') q = q.eq('contact_opted_in', false);

    const dealerId = p.get('dealer_id');
    if (dealerId) q = q.eq('dealer_id', dealerId);

    const target = p.get('target_company');
    if (target) {
      // Postgres ilike — '%' / '_' / '\\' escape (PostgREST escapes commas).
      const esc = target.replace(/[\\%_]/g, (c) => '\\' + c);
      q = q.ilike('target_company', `%${esc}%`);
    }

    const cursor = p.get('cursor');
    if (cursor) {
      const { t, i } = decodeCursor(cursor);
      q = q.or(`created_at.lt.${t},and(created_at.eq.${t},id.lt.${i})`);
    }

    q = q.order('created_at', { ascending: false })
         .order('id', { ascending: false })
         .limit(limit + 1);

    const { data, error } = await q;
    if (error) throw new ApiError('internal_error', 'responses query failed', { db: error.message });

    return jsonResponse(200, buildPage(data ?? [], limit), log.requestId);
  } catch (err) {
    log.error('voice-responses failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
