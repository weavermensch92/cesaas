// shared/heatmap_mapping.ts — CTT Moscow 2026 dealer 응답 → 8 segment × 6 axis 히트맵 산출.
//
// PART 4 STEP 2 매핑 알고리즘:
//   base       = hd_strength_matrix[segment][axis] * 100   (R_10.01.005 매트릭스, 0~1 → 0~100)
//   + self_report_boost  : B-Q1 1순위 +30, 2순위 +20, 3순위 +10
//   + pain_boost         : B-Q2 응답마다 axis_signals 매핑 axis에 +10
//   + gap_boost          : service axis에 (5 - service_sat) * 10
//   clip 0~100
//   tier: ≥80 primary · ≥50 secondary · ≥30 base · <30 none
//
// 호출:
//   responses-receive 핸들러가 axis_data 합성 직후 호출 → axis_data.heatmap_scores 첨부.
//   voice-heatmap Edge Function이 responses.axis_data->'heatmap_scores' 집계.
//
// hd_strength_matrix는 R_10.01_LeadScoring 의 hd_strength_matrix (040 시드).
// 룰 로드 실패 시 모든 axis 0으로 산출하지 않고 base 0으로 두어 self_report/pain/gap만으로 점수 산출 → 안전.

import { loadRule } from './rules.ts';
import { log } from './logger.ts';
import type { AxisData } from './segments.ts';
import type { LeadScoringYaml } from 'harness2/types.ts';
import { DW_AXES, type DWAxis } from '@hd/core/decision_weight';

export type HeatmapTier = 'primary' | 'secondary' | 'base' | 'none';

export type HeatmapScores = Record<DWAxis, number>;

const TIER_THRESHOLDS: Record<HeatmapTier, number> = {
  primary: 80,
  secondary: 50,
  base: 30,
  none: 0,
};

const SELF_REPORT_BOOST: Record<1 | 2 | 3, number> = { 1: 30, 2: 20, 3: 10 };
const PAIN_BOOST = 10;

// ============================================================================
// extractAxisDataV2 — 18문항 답변 배열 → AxisData v2 정제.
// surveys-get response.answers 와 동일한 [{question_id, answer}] 형태를 받음.
// answer는 type별:
//   single_select  → string (옵션 value)
//   multi_select   → string[]
//   scale_1_5      → number 1~5
//   consent        → boolean
// ============================================================================

type AnswerEntry = { question_id: string; answer: unknown };

const Q = {
  fleet:         'q_v2dctt_a1_fleet',
  work_env:      'q_v2dctt_a2_work_env',
  annual_days:   'q_v2dctt_a3_annual_days',
  decision_role: 'q_v2dctt_a4_decision_role',
  budget:        'q_v2dctt_a5_annual_budget',
  axis_ranks:    'q_v2dctt_b1_axis_ranks',
  pains:         'q_v2dctt_b2_pains',
  daily_hours:   'q_v2dctt_b3_daily_hours',
  brands:        'q_v2dctt_b4_brands',
  severity:      'q_v2dctt_b5_severity',
  service_sat:   'q_v2dctt_b6_service_sat',
  plan_12m:      'q_v2dctt_c1_plan_12m',
  equip_types:   'q_v2dctt_c2_equip_types',
  purchase_mode: 'q_v2dctt_c3_purchase_mode',
  booth:         'q_v2dctt_c4_booth_interest',
  d_role:        'q_v2dctt_d1_decision_role',
  channel:       'q_v2dctt_d3_channel',
} as const;

function answerFor(answers: AnswerEntry[], qid: string): unknown {
  const hit = answers.find((a) => a.question_id === qid);
  return hit?.answer;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(v: unknown): string[] | null {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return null;
}

export function extractAxisDataV2(answers: AnswerEntry[], surveyId: string): AxisData {
  // survey_v2_dealer_ctt가 아니면 빈 AxisData 반환 — 기존 v1 흐름이 그대로 동작.
  if (surveyId !== 'survey_v2_dealer_ctt') return {};

  return {
    work_env:           asString(answerFor(answers, Q.work_env)),
    fleet_size:         asString(answerFor(answers, Q.fleet)),
    annual_budget:      asString(answerFor(answers, Q.budget)),
    annual_days:        asString(answerFor(answers, Q.annual_days)),
    role:               asString(answerFor(answers, Q.decision_role)),
    daily_hours:        asString(answerFor(answers, Q.daily_hours)),
    severity:           asNumber(answerFor(answers, Q.severity)),
    service_sat:        asNumber(answerFor(answers, Q.service_sat)),
    self_report_ranks:  asStringArray(answerFor(answers, Q.axis_ranks)),
    pain_points:        asStringArray(answerFor(answers, Q.pains)),
    current_brands:     asStringArray(answerFor(answers, Q.brands)),
    purchase_mode:      asString(answerFor(answers, Q.purchase_mode)),
    plan_12m:           asString(answerFor(answers, Q.plan_12m)),
    equip_types:        asStringArray(answerFor(answers, Q.equip_types)),
    booth_interest:     asStringArray(answerFor(answers, Q.booth)),
    channel:            asString(answerFor(answers, Q.channel)),
  };
}

// ============================================================================
// computeAxisScores — STEP 2 공식. axis별 0~100.
//
// painAxisMap: pain value → axis_signals 매핑. 옵션 메타에 들어있지만 클라이언트가
// 답변만 보내고 옵션 메타는 서버 DB에서 fetch 필요. 본 함수는 R_10.07 v2 시드에 맞춰
// 인라인 매핑 — 변경 시 039 마이그레이션과 동기 갱신.
// ============================================================================

const PAIN_AXIS_MAP: Record<string, DWAxis[]> = {
  high_fuel_cost:      ['fuel'],
  frequent_breakdown:  ['durability'],
  slow_service:        ['service'],
  parts_shortage:      ['service'],
  high_purchase_cost:  ['price'],
  low_resale:          ['reference', 'price'],
  limited_attachments: ['versatility'],
  brand_trust:         ['reference'],
  financing_terms:     ['price'],
  operator_training:   ['service'],
  undercarriage_wear:  ['durability'],
  none:                [],
};

export function computeAxisScores(
  axisData: AxisData,
  hdStrength: Partial<Record<DWAxis, number>> | null | undefined,
): HeatmapScores {
  const scores: HeatmapScores = {
    price: 0, fuel: 0, durability: 0,
    service: 0, reference: 0, versatility: 0,
  };

  // ---- base — hd_strength_matrix[segment] * 100 ----
  for (const axis of DW_AXES) {
    const base = hdStrength?.[axis];
    if (typeof base === 'number' && Number.isFinite(base)) {
      scores[axis] = Math.max(0, Math.min(100, base * 100));
    }
  }

  // ---- self_report_boost (B-Q1 1·2·3순위) ----
  if (Array.isArray(axisData.self_report_ranks)) {
    axisData.self_report_ranks.slice(0, 3).forEach((axisKey, idx) => {
      const rank = (idx + 1) as 1 | 2 | 3;
      const boost = SELF_REPORT_BOOST[rank] ?? 0;
      if (DW_AXES.includes(axisKey as DWAxis)) {
        scores[axisKey as DWAxis] += boost;
      }
    });
  }

  // ---- pain_boost (B-Q2 응답마다 매핑 axis에 +10) ----
  if (Array.isArray(axisData.pain_points)) {
    for (const pain of axisData.pain_points) {
      const axes = PAIN_AXIS_MAP[pain];
      if (!axes) continue;
      for (const axis of axes) scores[axis] += PAIN_BOOST;
    }
  }

  // ---- gap_boost (service axis에 (5 - service_sat) * 10) ----
  if (typeof axisData.service_sat === 'number') {
    const gap = Math.max(0, Math.min(4, 5 - axisData.service_sat));
    scores.service += gap * 10;
  }

  // ---- clip 0~100 ----
  for (const axis of DW_AXES) {
    scores[axis] = Math.max(0, Math.min(100, Math.round(scores[axis])));
  }

  return scores;
}

// ============================================================================
// tierize — score → primary / secondary / base / none.
// ============================================================================

export function tierize(score: number): HeatmapTier {
  if (score >= TIER_THRESHOLDS.primary) return 'primary';
  if (score >= TIER_THRESHOLDS.secondary) return 'secondary';
  if (score >= TIER_THRESHOLDS.base) return 'base';
  return 'none';
}

export function tierizeAll(scores: HeatmapScores): Record<DWAxis, HeatmapTier> {
  const tiers = {} as Record<DWAxis, HeatmapTier>;
  for (const axis of DW_AXES) tiers[axis] = tierize(scores[axis]);
  return tiers;
}

// ============================================================================
// computeHeatmap — segment + axisData → scores + tiers.
// R_10.01 hd_strength_matrix를 로드해 base 산출. 로드 실패 시 base=0 (self_report/pain/gap만으로 점수).
// ============================================================================

export async function computeHeatmap(
  segment: string,
  axisData: AxisData,
): Promise<{ scores: HeatmapScores; tiers: Record<DWAxis, HeatmapTier> }> {
  let hdStrength: Partial<Record<DWAxis, number>> | null = null;
  try {
    const { body } = await loadRule<LeadScoringYaml>('R_10.01_LeadScoring');
    const matrix = (body as unknown as {
      hd_strength_matrix?: Record<string, Partial<Record<DWAxis, number>>>;
    }).hd_strength_matrix;
    hdStrength = matrix?.[segment] ?? null;
  } catch (e) {
    log('warn', 'computeHeatmap: R_10.01 load failed (base=0 fallback)', {
      segment, reason: e instanceof Error ? e.message : String(e),
    });
  }

  const scores = computeAxisScores(axisData, hdStrength);
  const tiers = tierizeAll(scores);
  return { scores, tiers };
}

export { TIER_THRESHOLDS };
