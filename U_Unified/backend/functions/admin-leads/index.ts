/**
 * GET /admin-leads — 통합 Lead 목록.
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['H_채널통합']
 *
 * Query:
 *   priority         콤마 (P1,P2)
 *   segment          콤마
 *   crm_id           단일
 *   has_sensor       'true' | 'false'
 *   has_voice        'true' | 'false'
 *   status           기본 active
 *   q                회사명·entity_id 검색 (prefix)
 *   limit · cursor
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { buildPage, decodeCursor, parseLimit } from 'shared/pagination.ts';

const ROUTE = '/admin-leads';

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
      .from('leads')
      .select('id, created_at, updated_at, crm_id, entity_id, score, priority, segment, status, sensor_count, voice_count, company_name, contact_name, contact_phone, amount, currency, stage, product_model, first_seen_at, last_seen_at, score_at');

    q = q.eq('status', p.get('status') ?? 'active');

    const crmId = p.get('crm_id');
    if (crmId) q = q.eq('crm_id', crmId);

    const segs = p.get('segment');
    if (segs) q = q.in('segment', segs.split(',').map((s) => s.trim()).filter(Boolean));

    const prios = p.get('priority');
    if (prios) q = q.in('priority', prios.split(',').map((s) => s.trim()).filter(Boolean));

    const hasSensor = p.get('has_sensor');
    if (hasSensor === 'true')  q = q.gt('sensor_count', 0);
    if (hasSensor === 'false') q = q.eq('sensor_count', 0);
    const hasVoice = p.get('has_voice');
    if (hasVoice === 'true')   q = q.gt('voice_count', 0);
    if (hasVoice === 'false')  q = q.eq('voice_count', 0);

    const search = p.get('q');
    if (search && search.length >= 2) {
      const like = `%${search}%`;
      q = q.or(`entity_id.ilike.${like},company_name.ilike.${like},contact_name.ilike.${like}`);
    }

    const cursor = p.get('cursor');
    if (cursor) {
      const { t, i } = decodeCursor(cursor);
      q = q.or(`updated_at.lt.${t},and(updated_at.eq.${t},id.lt.${i})`);
    }

    q = q.order('updated_at', { ascending: false })
         .order('id', { ascending: false })
         .limit(limit + 1);

    const { data, error } = await q;
    if (error) throw new ApiError('internal_error', 'leads query failed', { db: error.message });

    // buildPage 는 (created_at, id) 기준 — leads는 updated_at으로 정렬했으므로 manual.
    const rows = data ?? [];
    if (rows.length <= limit) {
      return jsonResponse(200, { data: rows, next_cursor: null }, log.requestId);
    }
    const cutoff = rows[limit - 1];
    const slice = rows.slice(0, limit);
    const ts = cutoff?.updated_at as string;
    const id = cutoff?.id as string;
    const next = ts && id ? Buffer.from(JSON.stringify({ t: ts, i: id }), 'utf8').toString('base64') : null;
    return jsonResponse(200, { data: slice, next_cursor: next }, log.requestId);
  } catch (err) {
    log.error('admin-leads failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
