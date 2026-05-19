// 서버 측 R_10.05 segment 매칭 (보조).
// 클라이언트가 보낸 segment + 신뢰도를 우선 사용하되, 서버에서도 deterministic 재계산해 검증.
//
// 데이터 경로 (Phase D.2 이후):
//   1순위 — shared/rules.ts loadRule('R_10.05_Classification') (DB rule_versions.active)
//           → harness2/apply_rules.ts classifyVoiceSegmentCore(rules, axis)
//           이 경로가 정상이면 hot reload 가능 (publish-rule.ts 갱신 후 5분 캐시 TTL 안 반영).
//   2순위 (fallback) — 아래 INLINE_RULES (이전 inline 미러).
//           DB 미시드/로드 실패 시 부스 현장 끊김 방지.
//
// 019_seed_r10_05_classification.sql 적용 후 1순위 경로 동작.
// 이전 동기 시그니처(`classifyServerSide(a): SegmentResult`)가 async로 변경.

import { loadRule } from './rules.ts';
import type { ClassificationYaml } from 'harness2/types.ts';
import { classifyVoiceSegmentCore } from 'harness2/apply_rules.ts';

export type AxisData = {
  scale?: string | null;
  usage?: string | null;
  annual_operating_hours?: string | null;
  annual_deal_rub?: string | null;
  fleet_size?: string | null;
  decision_role?: string | null;
};

export interface SegmentResult {
  segment: string;
  confidence: number;
  method: 'server_rule' | 'server_rule_fallback';
}

// ============================================================================
// Fallback — DB 로드 실패 시. 이전 v0.5 inline 미러. R_10.05 voice_segment와 동일 의미.
// ============================================================================
const INLINE_RULES: Array<{ segment: string; match: (a: AxisData) => boolean }> = [
  { segment: 'key_account',          match: (a) => a.annual_deal_rub === 'large' },
  { segment: 'mining',               match: (a) => a.usage === 'mining' && (a.scale === 'L' || a.scale === 'XL') },
  { segment: 'construction_heavy',   match: (a) => a.usage === 'construction_heavy' && ['M', 'L', 'XL'].includes(a.scale ?? '') },
  { segment: 'forestry',             match: (a) => a.usage === 'forestry' },
  { segment: 'agriculture',          match: (a) => a.usage === 'agriculture' },
  { segment: 'general_construction', match: (a) => a.usage === 'general_construction' },
  { segment: 'rental',               match: (a) => a.usage === 'rental' },
  { segment: 'other',                match: () => true },
];

function classifyInline(a: AxisData): SegmentResult {
  for (const r of INLINE_RULES) {
    if (r.match(a)) {
      return { segment: r.segment, confidence: 1.0, method: 'server_rule_fallback' };
    }
  }
  return { segment: 'other', confidence: 0.5, method: 'server_rule_fallback' };
}

// ============================================================================
// 메인 — R_10.05 DB 로드 + lib.classifyVoiceSegmentCore. 실패 시 inline fallback.
// ============================================================================
export async function classifyServerSide(a: AxisData): Promise<SegmentResult> {
  try {
    const { body } = await loadRule<ClassificationYaml>('R_10.05_Classification');
    if (!Array.isArray(body?.voice_segment)) {
      return classifyInline(a);
    }
    // AxisData와 lib VoiceResponse['axis']는 동일한 평탄 axis 객체 모양 — 런타임 호환.
    const segment = classifyVoiceSegmentCore(body, a as unknown as Parameters<typeof classifyVoiceSegmentCore>[1]);
    return { segment, confidence: 1.0, method: 'server_rule' };
  } catch (_e) {
    // DB 끊김·룰 미시드 등 — 부스 현장 끊김 방지 위해 fallback.
    return classifyInline(a);
  }
}
