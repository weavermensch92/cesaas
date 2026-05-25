/**
 * GET /voice-heatmap — CTT Moscow 2026 8 segment × 6 axis 히트맵 집계.
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * survey_v2_dealer_ctt 응답의 responses.axis_data->'heatmap_scores' 를 segment × axis로 평균.
 * Phase 3 responses-receive 핸들러가 응답마다 heatmap_scores를 채움.
 *
 * 기간 필터: from·to·event·survey_id (default 'survey_v2_dealer_ctt').
 * 응답:
 *   {
 *     matrix: [
 *       { segment: 'mining', respondents: 12, axes: { price: {avg, n, tier}, ... } }
 *     ],
 *     totals: { respondents, by_segment: {seg: n} },
 *     tier_thresholds: { primary: 80, secondary: 50, base: 30 }
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { DW_AXES, type DWAxis } from '@hd/core/decision_weight';

type Tier = 'primary' | 'secondary' | 'base' | 'none';
const TIER_THRESHOLDS = { primary: 80, secondary: 50, base: 30 };
const SEGMENTS_V2 = [
  'individual', 'fleet_rental', 'key_account', 'mining',
  'infrastructure', 'agri_plantation', 'quarry', 'gov_public',
] as const;

interface ResponseRow {
  segment: string | null;
  axis_data: { heatmap_scores?: Partial<Record<DWAxis, number>> } | null;
}

function tierOf(score: number): Tier {
  if (score >= TIER_THRESHOLDS.primary) return 'primary';
  if (score >= TIER_THRESHOLDS.secondary) return 'secondary';
  if (score >= TIER_THRESHOLDS.base) return 'base';
  return 'none';
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/voice-heatmap' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const p = url.searchParams;
    const surveyId = p.get('survey_id') ?? 'survey_v2_dealer_ctt';

    let q = db()
      .from('responses')
      .select('segment, axis_data')
      .eq('survey_id', surveyId);

    const from = p.get('from'); if (from) q = q.gte('captured_at', from);
    const to   = p.get('to');   if (to)   q = q.lte('captured_at', to);
    const event = p.get('event'); if (event) q = q.eq('event', event);

    // 메모리 집계 (PoC v1 < 10K rows).
    q = q.limit(10000);
    const { data, error } = await q;
    if (error) throw new ApiError('internal_error', 'heatmap query failed', { db: error.message });

    const rows = (data ?? []) as ResponseRow[];

    // segment × axis 누적
    const accum = new Map<string, {
      respondents: number;
      sums: Record<DWAxis, number>;
      counts: Record<DWAxis, number>;
    }>();
    const initBucket = () => ({
      respondents: 0,
      sums:   { price: 0, fuel: 0, durability: 0, service: 0, reference: 0, versatility: 0 },
      counts: { price: 0, fuel: 0, durability: 0, service: 0, reference: 0, versatility: 0 },
    });

    for (const r of rows) {
      const seg = r.segment ?? 'individual';   // R_10.05 v2 default
      const bucket = accum.get(seg) ?? initBucket();
      bucket.respondents += 1;
      const scores = r.axis_data?.heatmap_scores;
      if (scores) {
        for (const axis of DW_AXES) {
          const v = scores[axis];
          if (typeof v === 'number' && Number.isFinite(v)) {
            bucket.sums[axis] += v;
            bucket.counts[axis] += 1;
          }
        }
      }
      accum.set(seg, bucket);
    }

    // 8 segment 순서로 matrix 빌드. 누락 segment는 0건으로 표시.
    const allSegments = new Set<string>([...SEGMENTS_V2, ...Array.from(accum.keys())]);
    const matrix = Array.from(allSegments).map((segment) => {
      const b = accum.get(segment) ?? initBucket();
      const axes = {} as Record<DWAxis, { avg: number; n: number; tier: Tier }>;
      for (const axis of DW_AXES) {
        const n = b.counts[axis];
        const avg = n > 0 ? Math.round(b.sums[axis] / n) : 0;
        axes[axis] = { avg, n, tier: n > 0 ? tierOf(avg) : 'none' };
      }
      return { segment, respondents: b.respondents, axes };
    });
    // CTT v2 8 segment 먼저, 그 다음 legacy.
    matrix.sort((a, b) => {
      const ai = SEGMENTS_V2.indexOf(a.segment as typeof SEGMENTS_V2[number]);
      const bi = SEGMENTS_V2.indexOf(b.segment as typeof SEGMENTS_V2[number]);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.segment.localeCompare(b.segment);
    });

    const by_segment = Object.fromEntries(
      matrix.map((m) => [m.segment, m.respondents]),
    );

    return jsonResponse(200, {
      matrix,
      totals: { respondents: rows.length, by_segment },
      tier_thresholds: TIER_THRESHOLDS,
      survey_id: surveyId,
      truncated: rows.length >= 10000,
    }, log.requestId);
  } catch (err) {
    log.error('voice-heatmap failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
