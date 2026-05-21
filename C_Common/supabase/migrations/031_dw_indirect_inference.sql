-- 031_dw_indirect_inference.sql
-- DecisionWeight 6축 간접 추론 인프라.
-- - responses.dw_raw_answers JSONB  : 간접 5문항(Q3'~Q7') 원응답 + Q8' 자유응답 (감사·재계산용)
-- - responses.dw_extraction JSONB   : 산출 메타 (method/rule_version/llm_run_id/confidence)
-- - leads.dw_alignment REAL         : R_10.01.005 dw_alignment_bonus 캐시 (HD강점 내적 0~6)
--
-- 룰 시드:
-- - R_10.10_DecisionWeight v1   : 신규 (간접질문 추론 + LLM 보조)
-- - R_10.01_LeadScoring v1.1    : R_10.01.005_dw_alignment_bonus 규칙 추가
--
-- preference_axes 컬럼은 025_dealer_v2_preference_axes.sql에서 이미 존재 — 본 마이그레이션은 재사용.
-- DW 축 키: price · fuel · durability · service · reference · versatility (prd-v1 기존 스키마 일치).
--
-- 참고: V_50.08 / V_50.09 / V_50.10 / R_10.10 PRD 문서는 PRD/specs/decision_weight/ 참조.

-- ============================================================================
-- 1. responses 확장 — DW 원응답·추출 메타
-- ============================================================================
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS dw_raw_answers JSONB,
  ADD COLUMN IF NOT EXISTS dw_extraction  JSONB;

COMMENT ON COLUMN responses.dw_raw_answers IS
  '간접 5문항 Q3''~Q7'' 원응답 + Q8'' 자유응답. 매트릭스 정정 후 재계산용. 예: {"q3_prime":"B","q4_prime":["A","C"],...,"q8_prime":"..."}';
COMMENT ON COLUMN responses.dw_extraction IS
  'DW 산출 메타: {method:rule|rule+llm|rule_only_low_llm_confidence, rule_version, llm_run_id, llm_confidence}.';

-- preference_axes(1~5) 인덱스 — V_30.03 평균 DW 집계용
CREATE INDEX IF NOT EXISTS idx_responses_preference_axes_gin
  ON responses USING GIN (preference_axes)
  WHERE preference_axes IS NOT NULL;

-- ============================================================================
-- 2. leads 확장 — dw_alignment 캐시
-- ============================================================================
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS dw_alignment REAL;

COMMENT ON COLUMN leads.dw_alignment IS
  'R_10.01.005 dw_alignment_bonus 입력 — preference_axes(0~1 정규화) · hd_strength[segment] 내적(0~6). 점수 산출 시 갱신.';

-- ============================================================================
-- 3. 룰 시드 — R_10.10 DecisionWeight (신규)
-- ============================================================================
DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.10_DecisionWeight',
    '2026-05-22.001',
    $yaml$rule_id: R_10.10_DecisionWeight
version: 1
description: '간접 5질문 + 자유응답 1 → DW 6축(price·fuel·durability·service·reference·versatility) 추론'
harness: 2
v1_v2: v1
status: active
last_modified: '2026-05-22T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

input_schema:
  q3_prime: enum [A, B, C, D, E]
  q4_prime: array<enum [A, B, C, D]> max=2
  q5_prime: enum [A, B, C, D, E, F]
  q6_prime: enum [A, B, C, D]
  q7_prime: array<enum [A, B, C, D]> max=2
  q8_prime: string max=500 optional

weight_matrix:
  q3_prime:
    A: { price: 0.6, fuel: 0.4, durability: 0.0, service: 0.0, reference: 0.0, versatility: 0.0 }
    B: { price: 0.0, fuel: 0.7, durability: 0.3, service: 0.0, reference: 0.0, versatility: 0.0 }
    C: { price: 0.0, fuel: 0.3, durability: 0.0, service: 0.7, reference: 0.0, versatility: 0.0 }
    D: { price: 0.4, fuel: 0.0, durability: 0.4, service: 0.0, reference: 0.2, versatility: 0.0 }
    E: { price: 0.0, fuel: 0.0, durability: 0.0, service: 0.0, reference: 0.0, versatility: 1.0 }
  q4_prime:
    A: { price: 0.5, fuel: 0.5, durability: 0.0, service: 0.0, reference: 0.0, versatility: 0.0 }
    B: { price: 0.0, fuel: 0.0, durability: 0.2, service: 0.0, reference: 0.8, versatility: 0.0 }
    C: { price: 0.0, fuel: 0.0, durability: 0.0, service: 0.5, reference: 0.0, versatility: 0.5 }
    D: { price: 0.0, fuel: 0.0, durability: 0.3, service: 0.7, reference: 0.0, versatility: 0.0 }
  q5_prime:
    A: { price: 1.0, fuel: 0.0, durability: 0.0, service: 0.0, reference: 0.0, versatility: 0.0 }
    B: { price: 0.0, fuel: 1.0, durability: 0.0, service: 0.0, reference: 0.0, versatility: 0.0 }
    C: { price: 0.0, fuel: 0.0, durability: 1.0, service: 0.0, reference: 0.0, versatility: 0.0 }
    D: { price: 0.0, fuel: 0.0, durability: 0.0, service: 1.0, reference: 0.0, versatility: 0.0 }
    E: { price: 0.0, fuel: 0.0, durability: 0.0, service: 0.0, reference: 1.0, versatility: 0.0 }
    F: { price: 0.0, fuel: 0.0, durability: 0.0, service: 0.0, reference: 0.0, versatility: 1.0 }
  q6_prime:
    A: { price: 0.0, fuel: 0.0, durability: 0.5, service: 0.0, reference: 0.5, versatility: 0.0 }
    B: { price: 0.0, fuel: 0.7, durability: 0.3, service: 0.0, reference: 0.0, versatility: 0.0 }
    C: { price: 0.0, fuel: 0.0, durability: 0.0, service: 0.4, reference: 0.0, versatility: 0.6 }
    D: { price: 0.0, fuel: 0.0, durability: 0.0, service: 0.0, reference: 0.0, versatility: 1.0 }
  q7_prime:
    A: { price: 1.0, fuel: 0.0, durability: 0.0, service: 0.0, reference: 0.0, versatility: 0.0 }
    B: { price: 0.0, fuel: 0.0, durability: 0.0, service: 1.0, reference: 0.0, versatility: 0.0 }
    C: { price: 0.0, fuel: 0.0, durability: 0.0, service: 0.0, reference: 1.0, versatility: 0.0 }
    D: { price: 0.0, fuel: 0.0, durability: 0.5, service: 0.0, reference: 0.0, versatility: 0.5 }

rules:
  - id: R_10.10.001_rule_mode
    description: '5 간접질문 가중치 평균 산출 (0~1)'
    condition: 'any_of(q3_prime, q4_prime, q5_prime, q6_prime, q7_prime) != null'
    action: 'dw_normalized[axis] = clamp(sum(weight) / max(count, 1), 0, 1)'
    severity: MUST

  - id: R_10.10.002_missing_prior
    description: '응답한 질문 0개인 축은 prior 0.5'
    condition: 'count(responded_questions) == 0'
    action: 'dw_normalized[axis] = 0.5'
    severity: MUST

  - id: R_10.10.003_llm_assist
    description: "Q8' 자유응답 LLM 추출 (룰 0.7 + LLM 0.3)"
    condition: 'length(q8_prime) > 5 AND llm_result.confidence >= 0.6'
    action: 'dw_normalized = 0.7 * dw_normalized + 0.3 * llm_result.dw_partial'
    severity: SHOULD

  - id: R_10.10.004_llm_low_confidence
    description: 'LLM confidence < 0.6 무시'
    condition: 'length(q8_prime) > 5 AND llm_result.confidence < 0.6'
    action: 'dw_extraction.method = rule_only_low_llm_confidence'
    severity: MAY

  - id: R_10.10.005_to_preference_axes
    description: '0~1 → preference_axes 1~5 변환'
    condition: 'dw_normalized != null'
    action: 'preference_axes[axis] = clamp(1 + round(4 * dw_normalized[axis]), 1, 5)'
    severity: MUST

llm_assist:
  enabled: true
  prompt_template: 'dw_extraction_q8'
  confidence_threshold: 0.6
  rule_weight: 0.7
  llm_weight: 0.3
  trigger: 'length(q8_prime) > 5'
  async: true

output:
  type: object
  schema:
    dw_normalized: { price: float, fuel: float, durability: float, service: float, reference: float, versatility: float }
    preference_axes: { price: int, fuel: int, durability: int, service: int, reference: int, versatility: int }
    dw_extraction: { method: string, rule_version: string, llm_run_id: string, llm_confidence: float }
$yaml$,
    NULL,
    'system_migration',
    '031 — R_10.10 시드 — DW 6축 간접질문 추론 (C_Common/r_10_rules/R_10.10_DecisionWeight.yaml 1.0 스냅샷)'
  );

  ------------------------------------------------------------------
  -- R_10.01 LeadScoring v1.1 — R_10.01.005 dw_alignment_bonus 추가
  ------------------------------------------------------------------
  PERFORM publish_rule(
    'R_10.01_LeadScoring',
    '2026-05-22.001',
    $yaml$rule_id: R_10.01_LeadScoring
version: 1.1
description: '리드 점수 산출 (0~100). Voice 응답·Sensor 활동·CRM·DW 정렬 종합.'
harness: 2
v1_v2: v1
status: active
last_modified: '2026-05-22T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

input_schema:
  response:
    nps: int
    future_subscription: bool
    preference_axes: object
  lead:
    segment: string
    sensor_activity_count: int
    deal_amount_rub: int
    region: string
  reference:
    hd_strength: object

rules:
  - id: R_10.01.001_nps_high
    description: 'NPS ≥ 9 → 충성도 높음'
    condition: 'response.nps >= 9'
    action: 'score += 30'
    severity: SHOULD

  - id: R_10.01.002_high_value_segment_with_activity
    description: 'Mining 또는 Key Account + Sensor 활동 5건 이상'
    condition: "lead.segment in ['mining', 'key_account'] AND lead.sensor_activity_count >= 5"
    action: 'score += 40'
    severity: SHOULD

  - id: R_10.01.003_future_subscription
    description: '후속 영업 옵트인'
    condition: 'response.future_subscription == true'
    action: 'score += 20'
    severity: SHOULD

  - id: R_10.01.004_high_deal_amount
    description: '거래액 5M₽ 이상'
    condition: 'lead.deal_amount_rub >= 5000000'
    action: 'score += 30'
    severity: SHOULD

  - id: R_10.01.005_dw_alignment_bonus
    description: '응답 DW 6축(preference_axes 1~5) × segment별 HD 강점 매트릭스 내적 → 최대 +15'
    condition: 'response.preference_axes != null AND lead.segment != null AND hd_strength[lead.segment] != null'
    action: |
      normalized = { k: (v - 1) / 4 for k, v in response.preference_axes }
      alignment = dot(normalized, hd_strength[lead.segment])
      score += clip(round(alignment * 2.5), 0, 15)
    severity: SHOULD

hd_strength_matrix:
  mining:               { price: 0.4, fuel: 0.9, durability: 0.9, service: 0.6, reference: 0.7, versatility: 0.3 }
  key_account:          { price: 0.5, fuel: 0.7, durability: 0.8, service: 0.9, reference: 0.9, versatility: 0.5 }
  construction_heavy:   { price: 0.6, fuel: 0.7, durability: 0.8, service: 0.6, reference: 0.7, versatility: 0.6 }
  agriculture:          { price: 0.8, fuel: 0.5, durability: 0.6, service: 0.5, reference: 0.3, versatility: 0.8 }
  forestry:             { price: 0.5, fuel: 0.6, durability: 0.8, service: 0.5, reference: 0.4, versatility: 0.7 }
  general_construction: { price: 0.8, fuel: 0.5, durability: 0.6, service: 0.6, reference: 0.4, versatility: 0.7 }
  rental:               { price: 0.7, fuel: 0.6, durability: 0.7, service: 0.7, reference: 0.3, versatility: 0.8 }
  other:                { price: 0.5, fuel: 0.5, durability: 0.5, service: 0.5, reference: 0.5, versatility: 0.5 }

output:
  type: int
  clamp_min: 0
  clamp_max: 100
  default: 0
$yaml$,
    NULL,
    'system_migration',
    '031 — R_10.01 v1.1 — R_10.01.005_dw_alignment_bonus 추가 (최대 +15). HD강점 매트릭스 시드 (출장 후 정정 대기).'
  );
END
$migration$;

-- ============================================================================
-- 검증 — 새 룰 active 확인
-- ============================================================================
DO $verify$
DECLARE
  _dw_v10_count INT;
  _ls_v11_count INT;
BEGIN
  SELECT COUNT(*) INTO _dw_v10_count
    FROM rule_versions
    WHERE rule_id = 'R_10.10_DecisionWeight' AND status = 'active';
  SELECT COUNT(*) INTO _ls_v11_count
    FROM rule_versions
    WHERE rule_id = 'R_10.01_LeadScoring' AND status = 'active' AND version LIKE '2026-05-22%';

  IF _dw_v10_count != 1 THEN
    RAISE EXCEPTION '031 verification failed: R_10.10_DecisionWeight active count = %', _dw_v10_count;
  END IF;
  IF _ls_v11_count != 1 THEN
    RAISE EXCEPTION '031 verification failed: R_10.01_LeadScoring v1.1 active count = %', _ls_v11_count;
  END IF;
END
$verify$;
