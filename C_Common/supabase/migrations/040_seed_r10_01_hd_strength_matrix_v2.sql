-- 040_seed_r10_01_hd_strength_matrix_v2.sql
-- R_10.01 LeadScoring v1.2 — hd_strength_matrix 를 CTT 8 segment 체계로 갱신.
--
-- 변경 요지 (vs 020+031):
--   1) R_10.01.001~005 rule 5개(NPS·high_value_segment·future_subscription·high_deal_amount·dw_alignment_bonus) 보존.
--   2) R_10.01.002 high_value_segment_with_activity 의 segment 목록을 신규 키 호환으로 확장
--      ['mining', 'key_account', 'infrastructure'] — infrastructure(구 construction_heavy) 추가.
--   3) hd_strength_matrix 8 segment × 6 axis 신규 시드 — 사용자 PART 1 히트맵 0~100 점수 ÷ 100 정규화.
--      legacy 6 segment 키(construction_heavy / agriculture / forestry / general_construction / rental / other)는
--      백필 옵션을 위해 한시 보존 (기존 leads.segment row 호환). Phase 6 백필 후 별도 마이그레이션으로 제거 예정.
--   4) 신규 8 키: individual / fleet_rental / key_account / mining / infrastructure / agri_plantation / quarry / gov_public.
--
-- 출장 후 정정:
--   r20/bin/publish-rule.ts 로 매트릭스 값만 갱신 가능. 5분 캐시 TTL 내 V_Voice scoring·heatmap_mapping에
--   자동 반영. 코드 배포 불필요.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.01_LeadScoring',
    '2026-05-25.001',
    $yaml$rule_id: R_10.01_LeadScoring
version: 1.2
description: '리드 점수 산출 (0~100). Voice 응답·Sensor 활동·CRM·DW 정렬 종합. CTT 8 segment hd_strength_matrix.'
harness: 2
v1_v2: v2
status: active
last_modified: '2026-05-25T00:00:00Z'
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
    description: 'Mining / Key Account / Infrastructure + Sensor 활동 5건 이상'
    condition: "lead.segment in ['mining', 'key_account', 'infrastructure'] AND lead.sensor_activity_count >= 5"
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

# CTT 8 segment — 사용자 PART 1 히트맵 0~100 점수의 0~1 정규화.
# 위버 출장 후 위 publish-rule 로 정정 — 코드 배포 없이 hot reload (5분 TTL).
hd_strength_matrix:
  individual:        { price: 0.95, fuel: 0.85, durability: 0.70, service: 0.40, reference: 0.30, versatility: 0.90 }
  fleet_rental:      { price: 0.60, fuel: 0.95, durability: 0.80, service: 0.70, reference: 0.50, versatility: 0.60 }
  key_account:       { price: 0.40, fuel: 0.80, durability: 0.90, service: 0.95, reference: 1.00, versatility: 0.40 }
  mining:            { price: 0.30, fuel: 0.90, durability: 1.00, service: 0.85, reference: 0.80, versatility: 0.20 }
  infrastructure:    { price: 0.50, fuel: 0.85, durability: 0.85, service: 0.80, reference: 0.95, versatility: 0.50 }
  agri_plantation:   { price: 0.80, fuel: 0.90, durability: 0.60, service: 0.50, reference: 0.30, versatility: 1.00 }
  quarry:            { price: 0.40, fuel: 0.85, durability: 1.00, service: 0.75, reference: 0.70, versatility: 0.30 }
  gov_public:        { price: 0.50, fuel: 0.70, durability: 0.80, service: 1.00, reference: 0.90, versatility: 0.40 }
  # legacy 한시 보존 — 기존 leads.segment row 호환. 백필 후 제거.
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
    '040 — R_10.01 v1.2 — hd_strength_matrix 8 segment (CTT). legacy 6 한시 보존, R_10.01.002 segment 목록 infrastructure 추가.'
  );
END
$migration$;

-- ============================================================================
-- 검증
-- ============================================================================
DO $verify$
DECLARE
  _active_count INT;
BEGIN
  SELECT COUNT(*) INTO _active_count
    FROM rule_versions
    WHERE rule_id = 'R_10.01_LeadScoring' AND status = 'active' AND version = '2026-05-25.001';
  IF _active_count != 1 THEN
    RAISE EXCEPTION '040 verification failed: R_10.01 v1.2 active count = % (expected 1)', _active_count;
  END IF;
END
$verify$;
