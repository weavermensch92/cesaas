/**
 * GET /voice-aggregates — Insight v0 (V_30.03).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * 기간 필터 옵션: from·to·event.
 * 응답:
 *   {
 *     total: 수,
 *     by_segment: [{segment, dealer, visitor, total}],
 *     nps: { count, avg, detractors, passives, promoters },
 *     by_event: [{event, count}],
 *     by_language: [{language, count}]
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

interface ResponseRow {
  respondent_type: 'dealer' | 'visitor';
  segment: string | null;
  nps: number | null;
  event: string | null;
  language: string | null;
}

Deno.serve(async (req: Request) => {
  const log = requestLogger(req, { route: '/voice-aggregates' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const p = url.searchParams;
    let q = db()
      .from('responses')
      .select('respondent_type, segment, nps, event, language');

    const from = p.get('from');
    if (from) q = q.gte('captured_at', from);
    const to = p.get('to');
    if (to) q = q.lte('captured_at', to);
    const event = p.get('event');
    if (event) q = q.eq('event', event);

    // PostgREST는 정확한 group by가 어려워 — 단순 fetch + 메모리 집계 (PoC v1 < 10K row).
    q = q.limit(10000);
    const { data, error } = await q;
    if (error) throw new ApiError('internal_error', 'aggregates query failed', { db: error.message });

    const rows = (data ?? []) as ResponseRow[];

    const bySegmentMap = new Map<string, { dealer: number; visitor: number }>();
    let npsSum = 0, npsN = 0, det = 0, pas = 0, prom = 0;
    const byEvent = new Map<string, number>();
    const byLang  = new Map<string, number>();

    for (const r of rows) {
      const seg = r.segment ?? 'other';
      const cur = bySegmentMap.get(seg) ?? { dealer: 0, visitor: 0 };
      cur[r.respondent_type] += 1;
      bySegmentMap.set(seg, cur);

      if (typeof r.nps === 'number') {
        npsSum += r.nps; npsN += 1;
        if (r.nps <= 6) det += 1; else if (r.nps <= 8) pas += 1; else prom += 1;
      }
      if (r.event)    byEvent.set(r.event,    (byEvent.get(r.event)    ?? 0) + 1);
      if (r.language) byLang.set(r.language,  (byLang.get(r.language)  ?? 0) + 1);
    }

    const by_segment = Array.from(bySegmentMap.entries())
      .map(([segment, v]) => ({ segment, dealer: v.dealer, visitor: v.visitor, total: v.dealer + v.visitor }))
      .sort((a, b) => b.total - a.total);

    return jsonResponse(200, {
      total: rows.length,
      by_segment,
      nps: {
        count: npsN,
        avg: npsN > 0 ? +(npsSum / npsN).toFixed(2) : null,
        detractors: det,
        passives: pas,
        promoters: prom,
      },
      by_event:    Array.from(byEvent.entries()).map(([event, count]) => ({ event, count })),
      by_language: Array.from(byLang.entries()).map(([language, count]) => ({ language, count })),
      truncated: rows.length >= 10000,
    }, log.requestId);
  } catch (err) {
    log.error('voice-aggregates failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
