// harness2/lib/apply_rules.ts — R_10 룰을 실 데이터에 적용.
// PRD-03 § 4 R-022.
//
// 각 함수는 두 형태:
//   - *Core(rules, ...)   — 미리 로드된 YAML 객체로 동작 (DB·filesystem 무관)
//   - <name>(...)         — load_rules.ts의 filesystem 로더 + Core 호출
//
// Edge Function (Deno)은 shared/rules.ts(DB) → *Core 직접 호출 권장.
// Phase D: V_Voice/backend/shared/segments.ts가 classifyVoiceSegmentCore 사용.

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

export function applyLeadScoringCore(
  rules: LeadScoringYaml,
  context: EvaluationContext,
): ScoringResult {
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

export async function applyLeadScoring(context: EvaluationContext): Promise<ScoringResult> {
  const rules = await loadRules<LeadScoringYaml>('R_10.01_LeadScoring');
  return applyLeadScoringCore(rules, context);
}

// ============================================================================
// § 2. LeadQuality (R_10.02) → A/B/C/D
// ============================================================================

export function applyLeadQualityCore(rules: LeadQualityYaml, score: number): Grade {
  for (const t of rules.thresholds) {
    if (evaluateCondition(t.condition, { score })) return t.grade;
  }
  return rules.output.default;
}

export async function applyLeadQuality(score: number): Promise<Grade> {
  const rules = await loadRules<LeadQualityYaml>('R_10.02_LeadQuality');
  return applyLeadQualityCore(rules, score);
}

// ============================================================================
// § 3. Classification (R_10.05)
// ============================================================================

export function classifyVoiceSegmentCore(
  rules: ClassificationYaml,
  axis: VoiceResponse['axis'],
): Segment {
  for (const rule of rules.voice_segment) {
    if (evaluateCondition(rule.condition, { axis })) return rule.segment;
  }
  return 'other';
}

export async function classifyVoiceSegment(axis: VoiceResponse['axis']): Promise<Segment> {
  const rules = await loadRules<ClassificationYaml>('R_10.05_Classification');
  return classifyVoiceSegmentCore(rules, axis);
}

export function classifySensorScreenCore(
  rules: ClassificationYaml,
  url_path: string,
  crm_id = 'bitrix24',
): ScreenType | null {
  const patterns = rules.sensor_screen[`${crm_id}_patterns`];
  if (!Array.isArray(patterns)) return null;
  for (const p of patterns) {
    if (new RegExp(p.url_regex).test(url_path)) return p.screen;
  }
  return null;
}

export async function classifySensorScreen(
  url_path: string,
  crm_id = 'bitrix24',
): Promise<ScreenType | null> {
  const rules = await loadRules<ClassificationYaml>('R_10.05_Classification');
  return classifySensorScreenCore(rules, url_path, crm_id);
}

export function classifyLeadPriorityCore(rules: ClassificationYaml, score: number): Priority {
  for (const rule of rules.lead_priority) {
    if (evaluateCondition(rule.condition, { score })) return rule.priority;
  }
  return 'P5';
}

export async function classifyLeadPriority(score: number): Promise<Priority> {
  const rules = await loadRules<ClassificationYaml>('R_10.05_Classification');
  return classifyLeadPriorityCore(rules, score);
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
