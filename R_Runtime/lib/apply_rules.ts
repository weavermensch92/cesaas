// harness2/lib/apply_rules.ts — R_10 룰을 실 데이터에 적용.
// PRD-03 § 4 R-022.
//
// Phase B.1 시점: lib는 완성, YAML은 아직 Phase B.2에서 통일 중.
// applyLeadScoring 등은 R_10.01 YAML이 'rules: [{condition, action}]' 형태로
// 재작성된 후에야 정상 동작. 그 전까지 호출 시 evaluator 에러.

import { loadRules } from './load_rules.ts';
import { applyAction, evaluateCondition } from './evaluator.ts';
import type {
  ClassificationYaml,
  EvaluationContext,
  Grade,
  LeadQualityYaml,
  LeadScoringYaml,
  Priority,
  ScoringResult,
  ScreenType,
  Segment,
  VoiceResponse,
} from './types.ts';

// ============================================================================
// § 1. LeadScoring (R_10.01) → 0~100
// ============================================================================

export async function applyLeadScoring(context: EvaluationContext): Promise<ScoringResult> {
  const rules = await loadRules<LeadScoringYaml>('R_10.01_LeadScoring');

  let state: { score: number } = { score: rules.output.default };
  const applied: { id: string; delta: number }[] = [];

  for (const rule of rules.rules) {
    if (evaluateCondition(rule.condition, context)) {
      const before = state.score;
      state = applyAction(rule.action, state as unknown as Record<string, unknown>) as {
        score: number;
      };
      applied.push({ id: rule.id, delta: state.score - before });
    }
  }

  state.score = Math.max(
    rules.output.clamp_min,
    Math.min(rules.output.clamp_max, state.score),
  );
  return { score: state.score, applied_rules: applied };
}

// ============================================================================
// § 2. LeadQuality (R_10.02) → A/B/C/D
// ============================================================================

export async function applyLeadQuality(score: number): Promise<Grade> {
  const rules = await loadRules<LeadQualityYaml>('R_10.02_LeadQuality');
  for (const t of rules.thresholds) {
    if (evaluateCondition(t.condition, { score })) return t.grade;
  }
  return rules.output.default;
}

// ============================================================================
// § 3. Classification (R_10.05)
// ============================================================================

export async function classifyVoiceSegment(axis: VoiceResponse['axis']): Promise<Segment> {
  const rules = await loadRules<ClassificationYaml>('R_10.05_Classification');
  for (const rule of rules.voice_segment) {
    if (evaluateCondition(rule.condition, { axis })) return rule.segment;
  }
  return 'other';
}

export async function classifySensorScreen(
  url_path: string,
  crm_id = 'bitrix24',
): Promise<ScreenType | null> {
  const rules = await loadRules<ClassificationYaml>('R_10.05_Classification');
  const patterns = rules.sensor_screen[`${crm_id}_patterns`];
  if (!Array.isArray(patterns)) return null;

  for (const p of patterns) {
    if (new RegExp(p.url_regex).test(url_path)) return p.screen;
  }
  return null;
}

export async function classifyLeadPriority(score: number): Promise<Priority> {
  const rules = await loadRules<ClassificationYaml>('R_10.05_Classification');
  for (const rule of rules.lead_priority) {
    if (evaluateCondition(rule.condition, { score })) return rule.priority;
  }
  return 'P5';
}

// ============================================================================
// § 4. 전체 파이프라인 — Score → Grade → Priority → Segment
// ============================================================================

export interface LeadFullPipelineResult {
  score: number;
  grade: Grade;
  priority: Priority;
  segment?: Segment;
  applied_rules: { id: string; delta: number }[];
}

export async function applyFullPipeline(
  context: EvaluationContext,
): Promise<LeadFullPipelineResult> {
  const scoring = await applyLeadScoring(context);
  const grade = await applyLeadQuality(scoring.score);
  const priority = await classifyLeadPriority(scoring.score);

  let segment: Segment | undefined;
  if (context.axis) segment = await classifyVoiceSegment(context.axis);

  return {
    score: scoring.score,
    grade,
    priority,
    segment,
    applied_rules: scoring.applied_rules,
  };
}
