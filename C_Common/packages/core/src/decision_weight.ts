// decision_weight.ts — R_10.10 DecisionWeight 산출 함수 (간접 추론).
// 5 간접질문(Q3'~Q7') 보기 가중치 평균 → DW 6축 정규화(0~1) → preference_axes(1~5) 변환.
//
// 외부 의존 0 (Node·Deno 공용). Edge Function (Deno)은 deno.json imports의 `@hd/core/decision_weight`
// 매핑으로 본 파일 직접 참조. Node는 packages/core barrel을 통해 import.
//
// Q8' 자유응답 LLM 보조(R_10.10.003)는 비동기 큐로 별도 처리 — 본 함수는 룰 모드 산출만.

export type DWAxis =
  | 'price'
  | 'fuel'
  | 'durability'
  | 'service'
  | 'reference'
  | 'versatility';

export const DW_AXES: readonly DWAxis[] = [
  'price', 'fuel', 'durability', 'service', 'reference', 'versatility',
] as const;

export type Q3Choice = 'A' | 'B' | 'C' | 'D' | 'E';
export type Q4Choice = 'A' | 'B' | 'C' | 'D';
export type Q5Choice = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type Q6Choice = 'A' | 'B' | 'C' | 'D';
export type Q7Choice = 'A' | 'B' | 'C' | 'D';

export interface DWInput {
  q3_prime?: Q3Choice | null;
  q4_prime?: Q4Choice[] | null;
  q5_prime?: Q5Choice | null;
  q6_prime?: Q6Choice | null;
  q7_prime?: Q7Choice[] | null;
  q8_prime?: string | null;
}

export type AxisWeights = Record<DWAxis, number>;

export interface WeightMatrix {
  q3_prime?: Partial<Record<Q3Choice, AxisWeights>>;
  q4_prime?: Partial<Record<Q4Choice, AxisWeights>>;
  q5_prime?: Partial<Record<Q5Choice, AxisWeights>>;
  q6_prime?: Partial<Record<Q6Choice, AxisWeights>>;
  q7_prime?: Partial<Record<Q7Choice, AxisWeights>>;
}

export type DWExtractionMethod =
  | 'rule'
  | 'rule+llm'
  | 'rule_only_low_llm_confidence';

export interface DWExtraction {
  method: DWExtractionMethod;
  rule_version: string;
  llm_run_id: string | null;
  llm_confidence: number | null;
}

export interface DWResult {
  dw_normalized: AxisWeights;
  preference_axes: Record<DWAxis, number>;
  dw_extraction: DWExtraction;
}

export interface ComputeDwOptions {
  /** R_10.10 active version from rule_versions (e.g., '2026-05-22.001'). */
  ruleVersion?: string;
  /** 응답된 질문 0개일 때 적용할 prior (R_10.10.002, default 0.5). */
  missingPrior?: number;
}

const MISSING_PRIOR_DEFAULT = 0.5;

const ZERO_AXES = (): AxisWeights => ({
  price: 0, fuel: 0, durability: 0, service: 0, reference: 0, versatility: 0,
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function isNonEmptyArray<T>(v: T | T[] | null | undefined): v is T[] {
  return Array.isArray(v) && v.length > 0;
}

/**
 * 단일 응답(단일 보기 OR multi-select)에 대해 axis 가중치 벡터를 산출.
 * Multi-select은 보기별 가중치를 평균(보기 수로 나눔).
 * 반환 null = 매트릭스에 매핑된 가중치가 하나도 없거나 입력 비어있음.
 */
function questionWeights(
  choices: string | string[] | null | undefined,
  matrix: Partial<Record<string, AxisWeights>> | undefined,
): AxisWeights | null {
  if (!matrix) return null;
  const list = Array.isArray(choices)
    ? choices
    : (choices == null ? [] : [choices]);
  if (list.length === 0) return null;

  const acc = ZERO_AXES();
  let used = 0;
  for (const c of list) {
    const w = matrix[c];
    if (!w) continue;
    for (const axis of DW_AXES) acc[axis] += (w[axis] ?? 0);
    used += 1;
  }
  if (used === 0) return null;

  for (const axis of DW_AXES) acc[axis] /= used;
  return acc;
}

/**
 * R_10.10.001~005 룰 모드 산출.
 * - 응답된 질문 수로 평균(R_10.10.001)
 * - 응답 0건이면 모든 축 prior(R_10.10.002, default 0.5)
 * - clamp [0, 1] 후 preference_axes 1~5 변환(R_10.10.005)
 *
 * Q8' LLM 보조(R_10.10.003·.004)는 비동기 큐로 후속 — 본 함수는 method='rule' 고정.
 */
export function computeDw(
  input: DWInput,
  weightMatrix: WeightMatrix,
  opts: ComputeDwOptions = {},
): DWResult {
  const prior = opts.missingPrior ?? MISSING_PRIOR_DEFAULT;

  const perQuestion: AxisWeights[] = [];
  if (input.q3_prime != null) {
    const w = questionWeights(input.q3_prime, weightMatrix.q3_prime);
    if (w) perQuestion.push(w);
  }
  if (isNonEmptyArray(input.q4_prime)) {
    const w = questionWeights(input.q4_prime, weightMatrix.q4_prime);
    if (w) perQuestion.push(w);
  }
  if (input.q5_prime != null) {
    const w = questionWeights(input.q5_prime, weightMatrix.q5_prime);
    if (w) perQuestion.push(w);
  }
  if (input.q6_prime != null) {
    const w = questionWeights(input.q6_prime, weightMatrix.q6_prime);
    if (w) perQuestion.push(w);
  }
  if (isNonEmptyArray(input.q7_prime)) {
    const w = questionWeights(input.q7_prime, weightMatrix.q7_prime);
    if (w) perQuestion.push(w);
  }

  const dw_normalized = ZERO_AXES();
  if (perQuestion.length === 0) {
    for (const axis of DW_AXES) dw_normalized[axis] = clamp(prior, 0, 1);
  } else {
    for (const w of perQuestion) {
      for (const axis of DW_AXES) dw_normalized[axis] += w[axis];
    }
    for (const axis of DW_AXES) {
      dw_normalized[axis] = clamp(dw_normalized[axis] / perQuestion.length, 0, 1);
    }
  }

  const preference_axes = {} as Record<DWAxis, number>;
  for (const axis of DW_AXES) {
    preference_axes[axis] = clamp(1 + Math.round(4 * dw_normalized[axis]), 1, 5);
  }

  return {
    dw_normalized,
    preference_axes,
    dw_extraction: {
      method: 'rule',
      rule_version: opts.ruleVersion ?? 'unknown',
      llm_run_id: null,
      llm_confidence: null,
    },
  };
}

/**
 * 산출 결과의 preference_axes(1~5) → R_10.01.005 입력용 0~1 정규화.
 * lead_scoring.ts에서 hd_strength 내적 산출 시 재사용.
 */
export function normalizePreferenceAxes(
  preferenceAxes: Partial<Record<DWAxis, number>>,
): AxisWeights {
  const out = ZERO_AXES();
  for (const axis of DW_AXES) {
    const v = preferenceAxes[axis];
    if (v == null || !Number.isFinite(v)) continue;
    out[axis] = clamp((Number(v) - 1) / 4, 0, 1);
  }
  return out;
}

/**
 * 0~1 정규화 벡터 두 개의 내적 — R_10.01.005 dw_alignment.
 * 0 ≤ axis_count(6) × max(1*1) = 6 상한.
 */
export function dotAxes(
  a: Partial<Record<DWAxis, number>>,
  b: Partial<Record<DWAxis, number>>,
): number {
  let sum = 0;
  for (const axis of DW_AXES) {
    sum += (a[axis] ?? 0) * (b[axis] ?? 0);
  }
  return sum;
}
