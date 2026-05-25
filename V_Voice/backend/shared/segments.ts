// 서버 측 R_10.05 segment 매칭 (보조).
// 클라이언트가 보낸 segment + 신뢰도를 우선 사용하되, 서버에서도 deterministic 재계산해 검증.
//
// 데이터 경로:
//   1순위 — shared/rules.ts loadRule('R_10.05_Classification') (DB rule_versions.active)
//           → harness2/apply_rules.ts classifyVoiceSegmentCore(rules, axis)
//           hot reload 가능 (publish-rule.ts 5분 캐시 TTL).
//   2순위 (V-004 PRD-02 § 2) — LLM 보조 (R_10.06.segment_classifier · Claude Haiku)
//           1순위가 'other' 반환 + axis.usage 있으면 fire. 분류 실패해도 단계 1 결과 사용.
//   3순위 (fallback) — 아래 INLINE_RULES.
//           DB 끊김 등 양 단계 모두 실패 시 부스 현장 끊김 방지.
//
// 019_seed_r10_05_classification.sql + 023_reseed_r10_06_segment_classifier.sql 적용 후
// 1·2 단계 동작. 이전 동기 시그니처가 async로 변경.

import { loadRule } from './rules.ts';
import { callRule } from './llm.ts';
import { log } from './logger.ts';
import type { ClassificationYaml } from 'harness2/types.ts';
import { classifyVoiceSegmentCore } from 'harness2/apply_rules.ts';

export type AxisData = {
  // legacy v1
  scale?: string | null;
  usage?: string | null;
  annual_operating_hours?: string | null;
  annual_deal_rub?: string | null;
  decision_role?: string | null;
  // CTT v2 — survey_v2_dealer_ctt 신규 필드
  work_env?: string | null;
  fleet_size?: string | null;
  annual_budget?: string | null;
  annual_days?: string | null;
  role?: string | null;
  daily_hours?: string | null;
  severity?: number | null;
  service_sat?: number | null;
  self_report_ranks?: string[] | null;
  pain_points?: string[] | null;
  current_brands?: string[] | null;
  purchase_mode?: string | null;
  plan_12m?: string | null;
  equip_types?: string[] | null;
  booth_interest?: string[] | null;
  channel?: string | null;
  heatmap_scores?: Record<string, number> | null;
};

export interface SegmentResult {
  segment: string;
  confidence: number;
  method: 'server_rule' | 'server_llm' | 'server_rule_fallback';
}

// 유효 segment enum. LLM 응답 파싱 시 sanity check.
// CTT v2 8 + legacy v1 6 한시 보존.
const VALID_SEGMENTS = new Set([
  // CTT v2 — 8 segment
  'individual', 'fleet_rental', 'key_account', 'mining',
  'infrastructure', 'agri_plantation', 'quarry', 'gov_public',
  // legacy v1 — 한시 보존 (mining/key_account는 v2와 동일 키)
  'construction_heavy', 'agriculture', 'forestry',
  'general_construction', 'rental', 'other',
]);

// ============================================================================
// Fallback — DB 로드 실패 시. R_10.05 v2 voice_segment 미러 (037_seed).
// 1차: A-Q2 work_env 직접 매핑. 2차: fleet/budget/role 조합. 3차: legacy usage.
// ============================================================================
const INLINE_RULES: Array<{ segment: string; match: (a: AxisData) => boolean }> = [
  // 1차 — work_env 직접 매핑 (survey_v2_dealer_ctt q_v2dctt_a2_work_env 8지선다)
  { segment: 'individual',       match: (a) => a.work_env === 'individual_owner' },
  { segment: 'fleet_rental',     match: (a) => a.work_env === 'fleet_rental' },
  { segment: 'key_account',      match: (a) => a.work_env === 'large_corporate' },
  { segment: 'mining',           match: (a) => a.work_env === 'mining' },
  { segment: 'infrastructure',   match: (a) => a.work_env === 'infrastructure' },
  { segment: 'agri_plantation',  match: (a) => a.work_env === 'agri_plantation' },
  { segment: 'quarry',           match: (a) => a.work_env === 'quarry' },
  { segment: 'gov_public',       match: (a) => a.work_env === 'gov_public' },

  // 2차 — fleet + budget + role 조합 fallback
  { segment: 'key_account',      match: (a) =>
      a.annual_budget === 'XL' || (a.fleet_size === 'XL' && a.role === 'executive') },
  { segment: 'fleet_rental',     match: (a) => a.fleet_size === 'L' || a.fleet_size === 'XL' },

  // 3차 — legacy axis.usage 호환 (survey_v1_dealer 응답)
  { segment: 'mining',               match: (a) => a.usage === 'mining' },
  { segment: 'infrastructure',       match: (a) => a.usage === 'construction_heavy' },
  { segment: 'agri_plantation',      match: (a) => a.usage === 'agriculture' || a.usage === 'forestry' },
  { segment: 'fleet_rental',         match: (a) => a.usage === 'rental' },
  { segment: 'key_account',          match: (a) => a.annual_deal_rub === 'large' },

  // 기본값 — 미해당 시 individual
  { segment: 'individual',           match: () => true },
];

function classifyInline(a: AxisData): SegmentResult {
  for (const r of INLINE_RULES) {
    if (r.match(a)) {
      return { segment: r.segment, confidence: 1.0, method: 'server_rule_fallback' };
    }
  }
  return { segment: 'individual', confidence: 0.5, method: 'server_rule_fallback' };
}

// V-004 — LLM 보조. deterministic이 'other'·axis.usage/work_env 있을 때만 fire. 비용 게이트.
async function classifyViaLlm(a: AxisData): Promise<SegmentResult | null> {
  // axis 안에 분류기가 쓸 만한 단서가 충분한가? usage 또는 work_env 정도는 있어야 의미 있음.
  if (!a.usage && !a.work_env) return null;
  try {
    const axisJson = JSON.stringify(a);
    const userText = `6 axis 응답:\n${axisJson}\n\n위 응답으로 segment 분류. JSON만.`;
    const result = await callRule('R_10.06_PromptTemplates', 'segment_classifier', { userText });
    const parsed = parseSegmentJson(result.text);
    if (!parsed) {
      log('warn', 'segments LLM: invalid JSON', { reason: 'parse_failed', sample: result.text?.slice(0, 120) });
      return null;
    }
    if (!VALID_SEGMENTS.has(parsed.segment)) {
      log('warn', 'segments LLM: invalid segment enum', { value: parsed.segment });
      return null;
    }
    return {
      segment: parsed.segment,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.6,
      method: 'server_llm',
    };
  } catch (e) {
    log('warn', 'segments LLM: call failed', { reason: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function parseSegmentJson(text: string | undefined): { segment: string; confidence?: number } | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  // Claude가 가끔 fence 붙임 — 제거
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && typeof parsed.segment === 'string') {
      return { segment: parsed.segment, confidence: parsed.confidence };
    }
  } catch { /* ignore */ }
  return null;
}

// ============================================================================
// 메인 — DB R_10.05 deterministic → 필요시 LLM 보조 → 실패 시 inline fallback.
// ============================================================================
export async function classifyServerSide(a: AxisData): Promise<SegmentResult> {
  let determResult: SegmentResult;
  try {
    const { body } = await loadRule<ClassificationYaml>('R_10.05_Classification');
    if (!Array.isArray(body?.voice_segment)) {
      determResult = classifyInline(a);
    } else {
      // AxisData와 lib VoiceResponse['axis']는 동일한 평탄 axis 객체 모양 — 런타임 호환.
      const segment = classifyVoiceSegmentCore(body, a as unknown as Parameters<typeof classifyVoiceSegmentCore>[1]);
      determResult = { segment, confidence: 1.0, method: 'server_rule' };
    }
  } catch (_e) {
    determResult = classifyInline(a);
  }

  // V-004 — deterministic이 'other' + axis.usage/work_env 있으면 LLM 보조. 실패해도 deterministic 유지.
  // (037_v2 default 룰이 'individual'을 반환하므로 segment === 'other'는 *Core fall-through 케이스 한정.)
  if (determResult.segment === 'other' && (a.usage || a.work_env)) {
    const llm = await classifyViaLlm(a);
    if (llm) return llm;
  }

  return determResult;
}
