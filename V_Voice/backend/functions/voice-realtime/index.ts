/**
 * GET /voice-realtime — 실시간 응답률·에러 카드 (V-034).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * Query (optional):
 *   event=ctt_moscow_2026  부스 이벤트 필터
 *   lookback_min=15        최근 분당 응답률 산출 window (기본 15)
 *
 * 응답:
 *   {
 *     now: ISO,
 *     event: string | null,
 *     windows: {
 *       last_5m:  { total, dealer, visitor, errors, p_min: rate/min },
 *       last_1h:  { total, dealer, visitor, errors, p_min },
 *       last_24h: { total, dealer, visitor, errors, p_min }
 *     },
 *     last_response_at: ISO | null,
 *     lookback_min_rate: { window_min, total, per_min } | null  // 분당 평균 (지표 카드)
 *   }
 *
 * 에러 = 최근 normalize_queue.status='failed' (Sensor 측 LLM/검증 실패 누적).
 * Admin /voice/aggregates에서 10s 폴링.
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/voice-realtime';

interface WindowStat {
  total: number;
  dealer: number;
  visitor: number;
  errors: number;
  per_min: number;
}

async function countResponses(opts: {
  sinceIso: string;
  event: string | null;
  respondentType?: 'dealer' | 'visitor';
}): Promise<number> {
  let q = db()
    .from('responses')
    .select('id', { count: 'exact', head: true })
    .gte('captured_at', opts.sinceIso);
  if (opts.event) q = q.eq('event', opts.event);
  if (opts.respondentType) q = q.eq('respondent_type', opts.respondentType);
  const { count, error } = await q;
  if (error) throw new ApiError('internal_error', 'count failed', { db: error.message });
  return count ?? 0;
}

async function countErrors(sinceIso: string): Promise<number> {
  const { count, error } = await db()
    .from('normalize_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('completed_at', sinceIso);
  if (error) {
    // normalize_queue 없거나 status enum 차이 — 0으로 graceful
    return 0;
  }
  return count ?? 0;
}

async function lastResponseAt(event: string | null): Promise<string | null> {
  let q = db()
    .from('responses')
    .select('captured_at')
    .order('captured_at', { ascending: false })
    .limit(1);
  if (event) q = q.eq('event', event);
  const { data } = await q;
  const row = (data ?? [])[0] as { captured_at?: string } | undefined;
  return row?.captured_at ?? null;
}

async function buildWindow(sinceIso: string, minutes: number, event: string | null): Promise<WindowStat> {
  const [total, dealer, visitor, errors] = await Promise.all([
    countResponses({ sinceIso, event }),
    countResponses({ sinceIso, event, respondentType: 'dealer' }),
    countResponses({ sinceIso, event, respondentType: 'visitor' }),
    countErrors(sinceIso),
  ]);
  const perMin = minutes > 0 ? Number((total / minutes).toFixed(2)) : 0;
  return { total, dealer, visitor, errors, per_min: perMin };
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const event = url.searchParams.get('event') || null;
    const lookbackMinRaw = Number(url.searchParams.get('lookback_min') ?? '15');
    const lookbackMin = Number.isFinite(lookbackMinRaw) && lookbackMinRaw > 0 && lookbackMinRaw <= 1440
      ? Math.floor(lookbackMinRaw)
      : 15;

    const now = new Date();
    const since5m  = new Date(now.getTime() -      5 * 60_000).toISOString();
    const since1h  = new Date(now.getTime() -     60 * 60_000).toISOString();
    const since24h = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const sinceLb  = new Date(now.getTime() - lookbackMin * 60_000).toISOString();

    const [w5m, w1h, w24h, lastAt, lookbackTotal] = await Promise.all([
      buildWindow(since5m,  5,   event),
      buildWindow(since1h,  60,  event),
      buildWindow(since24h, 1440, event),
      lastResponseAt(event),
      countResponses({ sinceIso: sinceLb, event }),
    ]);

    const body = {
      now: now.toISOString(),
      event,
      windows: { last_5m: w5m, last_1h: w1h, last_24h: w24h },
      last_response_at: lastAt,
      lookback_min_rate: {
        window_min: lookbackMin,
        total: lookbackTotal,
        per_min: Number((lookbackTotal / lookbackMin).toFixed(2)),
      },
    };

    log.info('realtime served', {
      event, last_5m: w5m.total, last_1h: w1h.total, last_24h: w24h.total,
    });
    return jsonResponse(200, body, log.requestId);
  } catch (err) {
    log.error('voice-realtime failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
