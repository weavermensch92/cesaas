/**
 * GET /admin-llm-usage?days=7  → 일자별·function별·model별 호출수·토큰·비용
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * 응답:
 *   {
 *     range: { days, since_iso },
 *     totals: { calls, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, errors },
 *     by_day: [{ day, total_cost_usd, calls, input_tokens, output_tokens }],
 *     rows:   [{ day, function_name, model, calls, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, errors }]
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

interface Row {
  day: string;
  function_name: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
  errors: number;
}

Deno.serve(async (req: Request) => {
  const log = requestLogger(req, { route: '/admin-llm-usage' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const daysParam = url.searchParams.get('days');
    const days = clampInt(daysParam, 1, 90, 7);

    const { data, error } = await db().rpc('get_llm_usage_summary', { p_days: days });
    if (error) throw new ApiError('internal_error', 'aggregate failed', { db: error.message });

    const rows: Row[] = (data ?? []).map((r: Record<string, unknown>) => ({
      day: String(r.day),
      function_name: String(r.function_name),
      model: String(r.model),
      calls: Number(r.calls ?? 0),
      input_tokens: Number(r.input_tokens ?? 0),
      output_tokens: Number(r.output_tokens ?? 0),
      cache_read_tokens: Number(r.cache_read_tokens ?? 0),
      cache_creation_tokens: Number(r.cache_creation_tokens ?? 0),
      total_cost_usd: Number(r.total_cost_usd ?? 0),
      errors: Number(r.errors ?? 0),
    }));

    const totals = rows.reduce((a, r) => {
      a.calls += r.calls;
      a.input_tokens += r.input_tokens;
      a.output_tokens += r.output_tokens;
      a.cache_read_tokens += r.cache_read_tokens;
      a.cache_creation_tokens += r.cache_creation_tokens;
      a.total_cost_usd += r.total_cost_usd;
      a.errors += r.errors;
      return a;
    }, {
      calls: 0, input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_creation_tokens: 0,
      total_cost_usd: 0, errors: 0,
    });

    const byDayMap = new Map<string, { day: string; calls: number; input_tokens: number; output_tokens: number; total_cost_usd: number }>();
    for (const r of rows) {
      const d = byDayMap.get(r.day) ?? { day: r.day, calls: 0, input_tokens: 0, output_tokens: 0, total_cost_usd: 0 };
      d.calls += r.calls;
      d.input_tokens += r.input_tokens;
      d.output_tokens += r.output_tokens;
      d.total_cost_usd += r.total_cost_usd;
      byDayMap.set(r.day, d);
    }
    const by_day = Array.from(byDayMap.values()).sort((a, b) => b.day.localeCompare(a.day));

    const since = new Date(Date.now() - days * 86400_000);

    return jsonResponse(200, {
      range: { days, since_iso: since.toISOString() },
      totals,
      by_day,
      rows,
    }, log.requestId);
  } catch (err) {
    log.error('admin-llm-usage failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

function clampInt(v: string | null, min: number, max: number, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
