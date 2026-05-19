-- 020_seed_r10_01_02.sql
-- R_10.01 LeadScoring + R_10.02 LeadQuality 를 DB rule_versions(active)로 시드.
-- leads.grade 컬럼 추가 (R_10.02 출력 저장).
-- C_Common/r_10_rules/ 의 1.0 스냅샷.
--
-- Phase D.3 의존:
--   V_Voice/backend/shared/lead_scoring.ts 가 이 3 룰(.01·.02·.05)을 모두 로드 후 *Core 호출.
--   이 migration 적용 전에는 scoreLead가 rule not_found로 fallback 무점수.
--
-- 후속:
--   021_disable_trigger_scoring.sql — upsert_lead_from_*에서 PERFORM score_lead 라인 제거.

-- ----------------------------------------------------------------------------
-- leads.grade — R_10.02 출력 (A/B/C/D)
-- ----------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS grade TEXT
    CHECK (grade IN ('A', 'B', 'C', 'D'));

COMMENT ON COLUMN leads.grade IS 'R_10.02 LeadQuality 결과. A=≥80 B=50-79 C=25-49 D=<25.';

CREATE INDEX IF NOT EXISTS idx_leads_grade ON leads(grade) WHERE grade IS NOT NULL;

DO $migration$
BEGIN
  ------------------------------------------------------------------
  -- R_10.01 LeadScoring (4 시드 규칙)
  ------------------------------------------------------------------
  PERFORM publish_rule(
    'R_10.01_LeadScoring',
    '2026-05-19.001',
    $yaml$rule_id: R_10.01_LeadScoring
version: 1
description: '리드 점수 산출 (0~100). Voice 응답·Sensor 활동·CRM 데이터 종합.'
harness: 2
v1_v2: v1
status: active
last_modified: '2026-05-19T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

input_schema:
  response:
    nps: int
    future_subscription: bool
  lead:
    segment: string
    sensor_activity_count: int
    deal_amount_rub: int
    region: string

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

output:
  type: int
  clamp_min: 0
  clamp_max: 100
  default: 0
$yaml$,
    NULL,
    'system_migration',
    '020 — R_10.01 초기 시드 (Phase D.3 — score_lead trigger 대체 lib 기반 scoring helper용)'
  );

  ------------------------------------------------------------------
  -- R_10.02 LeadQuality (A/B/C/D 임계 80/50/25)
  ------------------------------------------------------------------
  PERFORM publish_rule(
    'R_10.02_LeadQuality',
    '2026-05-19.001',
    $yaml$rule_id: R_10.02_LeadQuality
version: 1
description: '리드 등급 분류 (4 등급)'
harness: 2
v1_v2: v1
status: active
last_modified: '2026-05-19T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

input_schema:
  score: int

thresholds:
  - id: R_10.02.001_grade_a
    description: 'High Priority — 즉시 본격 영업'
    condition: 'score >= 80'
    grade: A
    severity: MUST

  - id: R_10.02.002_grade_b
    description: 'Standard — 일반 follow-up'
    condition: 'score >= 50 AND score < 80'
    grade: B
    severity: MUST

  - id: R_10.02.003_grade_c
    description: 'Low — 정기 contact'
    condition: 'score >= 25 AND score < 50'
    grade: C
    severity: MUST

  - id: R_10.02.004_grade_d
    description: 'Cold — 관망'
    condition: 'score < 25'
    grade: D
    severity: MUST

output:
  type: string
  enum: [A, B, C, D]
  default: D

playbook_hint:
  A: 'priority_now'
  B: 'standard_followup'
  C: 'periodic_contact'
  D: 'watch_only'
$yaml$,
    NULL,
    'system_migration',
    '020 — R_10.02 초기 시드 (Phase D.3 — grade 산출용)'
  );
END
$migration$;
