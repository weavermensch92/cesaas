/**
 * GET /admin-test-summary — T_08 통과 판정 데이터.
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * 응답:
 *   {
 *     metrics: [{ id, label, hypothesis, source, threshold, current, status, samples, note }],
 *     hypothesis_breakdown: [{ hypothesis, pass, fail, skip, avg_metric, sample_metric_name }],
 *     recent_runs: [...],
 *     verdict: { quantitative_passed: 7, quantitative_total: 9, status: 'pass'|'partial'|'fail' }
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/admin-test-summary';

interface Metric {
  id: string;
  label: string;
  hypothesis: string;
  source: string;
  threshold: string;
  unit?: string;
  current: number | string | null;
  status: 'pass' | 'warn' | 'fail' | 'insufficient_data';
  samples: number;
  note?: string;
}

Deno.serve(async (req: Request) => {
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const sinceParam = url.searchParams.get('since');
    const sinceIso = sinceParam ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const supa = db();
    const metrics: Metric[] = [];

    // ----- 1. H1 송출 성공률 (≥98%) -----
    {
      const { data } = await supa
        .from('test_assertions')
        .select('metric_value')
        .eq('hypothesis', 'H1')
        .eq('metric_name', 'success_rate')
        .gte('created_at', sinceIso);
      const arr = (data ?? []).map((r) => Number(r.metric_value)).filter((v) => Number.isFinite(v));
      const avg = arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
      metrics.push({
        id: 'h1_success_rate',
        label: '캡쳐·송출 성공률',
        hypothesis: 'H1', source: 'test_assertions',
        threshold: '≥ 98%', unit: '%',
        current: avg !== null ? +avg.toFixed(2) : null,
        status: avg === null ? 'insufficient_data' : avg >= 98 ? 'pass' : avg >= 90 ? 'warn' : 'fail',
        samples: arr.length,
      });
    }

    // ----- 2. H1 P95 latency (≤5초 = 5000ms) -----
    {
      const { data } = await supa
        .from('test_assertions')
        .select('metric_value')
        .eq('hypothesis', 'H1')
        .eq('metric_name', 'p95_ms')
        .gte('created_at', sinceIso);
      const arr = (data ?? []).map((r) => Number(r.metric_value)).filter((v) => Number.isFinite(v));
      const max = arr.length > 0 ? Math.max(...arr) : null;
      metrics.push({
        id: 'h1_p95_latency',
        label: 'finalize P95 latency',
        hypothesis: 'H1', source: 'test_assertions',
        threshold: '≤ 5,000ms', unit: 'ms',
        current: max,
        status: max === null ? 'insufficient_data' : max <= 5000 ? 'pass' : max <= 10000 ? 'warn' : 'fail',
        samples: arr.length,
      });
    }

    // ----- 3. 7 화면 종류 커버 -----
    {
      const { data } = await supa
        .from('captures')
        .select('screen_type')
        .not('screen_type', 'is', null);
      const types = new Set((data ?? []).map((r) => r.screen_type as string));
      const required = ['deal_list','deal_detail','company','contact','activity','funnel','task'];
      const covered = required.filter((t) => types.has(t)).length;
      metrics.push({
        id: 'h1_screen_coverage',
        label: '7 화면 종류 커버',
        hypothesis: 'H1', source: 'captures',
        threshold: '7/7', unit: '',
        current: `${covered}/7`,
        status: covered === 7 ? 'pass' : covered >= 5 ? 'warn' : covered === 0 ? 'insufficient_data' : 'fail',
        samples: types.size,
      });
    }

    // ----- 4. 1 고객당 1주 캡쳐 (≥5건 max entity) -----
    {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supa
        .from('captures')
        .select('entity_id')
        .not('entity_id', 'is', null)
        .gte('captured_at', weekAgo);
      const counts = new Map<string, number>();
      for (const r of data ?? []) {
        const k = r.entity_id as string;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const max = counts.size === 0 ? 0 : Math.max(...counts.values());
      metrics.push({
        id: 'h2_per_customer_weekly',
        label: '1 고객당 1주 캡쳐 (최대)',
        hypothesis: 'H2', source: 'captures',
        threshold: '≥ 5건', unit: '건',
        current: max,
        status: counts.size === 0 ? 'insufficient_data' : max >= 5 ? 'pass' : max >= 3 ? 'warn' : 'fail',
        samples: counts.size,
        note: `${counts.size}개 entity`,
      });
    }

    // ----- 5. 13 필드 가중 confidence 평균 (v1 시도 — 임계 60% 권고) -----
    {
      const { data } = await supa
        .from('normalized_fields')
        .select('deal_id_confidence, company_name_confidence, contact_name_confidence, contact_phone_confidence, amount_confidence, stage_confidence, product_model_confidence, region_confidence, responsible_dealer_confidence')
        .eq('status', 'active');
      const samples = data ?? [];
      let sum = 0, n = 0;
      for (const r of samples) {
        for (const v of Object.values(r as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n += 1; }
        }
      }
      const avg = n === 0 ? null : (sum / n) * 100;
      metrics.push({
        id: 'h3_field_confidence',
        label: '13 필드 가중 confidence 평균',
        hypothesis: 'H3', source: 'normalized_fields',
        threshold: '≥ 60% (v1 시도)', unit: '%',
        current: avg === null ? null : +avg.toFixed(1),
        status: avg === null ? 'insufficient_data' : avg >= 60 ? 'pass' : avg >= 40 ? 'warn' : 'fail',
        samples: samples.length,
      });
    }

    // ----- 6. 정규화 시도율 (100%) -----
    {
      const { count: total } = await supa
        .from('entity_clusters')
        .select('id', { count: 'exact', head: true });
      const { count: tried } = await supa
        .from('entity_clusters')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending_normalize', 'normalizing', 'normalized', 'failed']);
      const rate = !total ? null : ((tried ?? 0) / total) * 100;
      metrics.push({
        id: 'h3_normalize_attempt',
        label: '정규화 시도율',
        hypothesis: 'H3', source: 'entity_clusters',
        threshold: '100%', unit: '%',
        current: rate === null ? null : +rate.toFixed(1),
        status: rate === null ? 'insufficient_data' : rate >= 99.9 ? 'pass' : rate >= 90 ? 'warn' : 'fail',
        samples: total ?? 0,
        note: `${tried ?? 0} / ${total ?? 0}`,
      });
    }

    // ----- 7. Dealer Playbook 발급 수 (≥10) -----
    {
      const { count } = await supa
        .from('dealer_outputs')
        .select('id', { count: 'exact', head: true });
      const c = count ?? 0;
      metrics.push({
        id: 'v_dealer_playbook',
        label: 'Dealer Playbook 발급 수',
        hypothesis: 'V_가설', source: 'dealer_outputs',
        threshold: '≥ 10건', unit: '건',
        current: c,
        status: c >= 10 ? 'pass' : c >= 5 ? 'warn' : c === 0 ? 'insufficient_data' : 'fail',
        samples: c,
      });
    }

    // ----- 8. Visitor 응답 수 (≥20) -----
    {
      const { count } = await supa
        .from('responses')
        .select('id', { count: 'exact', head: true })
        .eq('respondent_type', 'visitor');
      const c = count ?? 0;
      metrics.push({
        id: 'v_visitor_responses',
        label: 'Visitor 응답 수',
        hypothesis: 'V_가설', source: 'responses',
        threshold: '≥ 20건', unit: '건',
        current: c,
        status: c >= 20 ? 'pass' : c >= 10 ? 'warn' : c === 0 ? 'insufficient_data' : 'fail',
        samples: c,
      });
    }

    // ----- 9. 외부 컨트롤 사이클 (publish_rule actor != system_seed) -----
    {
      const { count } = await supa
        .from('rule_audit')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'publish')
        .neq('actor', 'system_seed');
      const c = count ?? 0;
      metrics.push({
        id: 'control_cycle',
        label: '외부 컨트롤 사이클',
        hypothesis: 'H_외부컨트롤', source: 'rule_audit',
        threshold: '≥ 1회', unit: '회',
        current: c,
        status: c >= 1 ? 'pass' : 'insufficient_data',
        samples: c,
        note: 'publish_rule() 호출 후 actor != system_seed',
      });
    }

    // ----- 가설별 통과/실패 GROUP BY -----
    const { data: assertionsData } = await supa
      .from('test_assertions')
      .select('hypothesis, status, metric_name, metric_value')
      .gte('created_at', sinceIso)
      .not('hypothesis', 'is', null);
    const byHyp = new Map<string, { pass: number; fail: number; skip: number; metrics: { name: string; sum: number; count: number } | null }>();
    for (const a of assertionsData ?? []) {
      const h = a.hypothesis as string;
      const cur = byHyp.get(h) ?? { pass: 0, fail: 0, skip: 0, metrics: null };
      if (a.status === 'pass') cur.pass += 1;
      else if (a.status === 'fail') cur.fail += 1;
      else if (a.status === 'skip') cur.skip += 1;
      if (a.metric_name && typeof a.metric_value === 'number') {
        if (!cur.metrics || cur.metrics.name === a.metric_name) {
          cur.metrics = {
            name: a.metric_name as string,
            sum: (cur.metrics?.sum ?? 0) + (a.metric_value as number),
            count: (cur.metrics?.count ?? 0) + 1,
          };
        }
      }
      byHyp.set(h, cur);
    }
    const hypothesis_breakdown = Array.from(byHyp.entries()).map(([h, v]) => ({
      hypothesis: h,
      pass: v.pass, fail: v.fail, skip: v.skip,
      sample_metric_name: v.metrics?.name ?? null,
      avg_metric: v.metrics ? +(v.metrics.sum / v.metrics.count).toFixed(2) : null,
    })).sort((a, b) => a.hypothesis.localeCompare(b.hypothesis));

    // ----- 최근 runs -----
    const { data: recentRuns } = await supa
      .from('test_runs')
      .select('id, started_at, completed_at, suite, scenario, actor, status, passed_count, failed_count, skipped_count, duration_ms, notes')
      .order('started_at', { ascending: false })
      .limit(20);

    // ----- 종합 verdict -----
    const quantitative_passed = metrics.filter((m) => m.status === 'pass').length;
    const quantitative_total = metrics.length;
    const quantitative_fail = metrics.filter((m) => m.status === 'fail').length;
    const verdict_status: 'pass' | 'partial' | 'fail' | 'insufficient_data' =
      quantitative_passed === quantitative_total ? 'pass'
      : quantitative_fail > 2 ? 'fail'
      : quantitative_passed >= 6 ? 'partial'
      : 'insufficient_data';

    return jsonResponse(200, {
      since: sinceIso,
      metrics,
      hypothesis_breakdown,
      recent_runs: recentRuns ?? [],
      verdict: {
        quantitative_passed,
        quantitative_total,
        quantitative_fail,
        status: verdict_status,
      },
    }, log.requestId);
  } catch (err) {
    log.error('admin-test-summary failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
