-- 037_seed_r10_05_classification_v2.sql
-- R_10.05 Classification 을 CTT Moscow 2026 dealer survey_v2_dealer_ctt 8 segment 체계로 갱신.
--
-- 변경 요지 (vs 019):
--   1) voice_segment 8개로 재정의 — individual / fleet_rental / key_account / mining /
--      infrastructure / agri_plantation / quarry / gov_public.
--      legacy 7개 (construction_heavy / agriculture / forestry / general_construction / rental / other) 제거.
--      construction_heavy → infrastructure, rental → fleet_rental, agriculture+forestry → agri_plantation rename/merge.
--      individual, quarry, gov_public 신규.
--   2) 1차 분류 키: axis.work_env (A-Q2 8지선다 단일 응답) — survey_v2_dealer_ctt q_v2dctt_a2_work_env.
--   3) 2차 fallback: axis.fleet_size + axis.annual_budget + axis.role (A-Q1 / A-Q5 / A-Q4).
--   4) lead_priority(P1~P5) 보존.
--   5) voice_segment_labels 8개 ko/ru/en 갱신.
--
-- 의존:
--   classifyVoiceSegmentCore (R_Runtime/lib/apply_rules.ts) 는 axis.* 필드 모두 generic하게 처리하므로
--   본 마이그레이션 적용 후 5분 캐시 TTL 내 V_Voice/backend/shared/segments.ts 자동 8 segment 반환.
--
-- 후속:
--   r20/bin/publish-rule.ts 로 추후 정정. 5분 캐시 TTL 내 자동 반영.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.05_Classification',
    '2026-05-25.001',
    $yaml$rule_id: R_10.05_Classification
version: 2
description: 'Voice segment (8 CTT) · Sensor screen · LeadPriority 분류'
harness: 2
v1_v2: v2
status: active
last_modified: '2026-05-25T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

voice_segment:
  # ---------- 1차 (S1) — A-Q2 work_env 직접 매핑 ----------
  - id: R_10.05.001_individual
    description: '개인 사업자 — A-Q2 individual_owner'
    condition: "axis.work_env == 'individual_owner'"
    segment: individual
    severity: MUST

  - id: R_10.05.002_fleet_rental
    description: '플릿·렌탈 — A-Q2 fleet_rental'
    condition: "axis.work_env == 'fleet_rental'"
    segment: fleet_rental
    severity: MUST

  - id: R_10.05.003_key_account
    description: '대형 법인·키 어카운트 — A-Q2 large_corporate'
    condition: "axis.work_env == 'large_corporate'"
    segment: key_account
    severity: MUST

  - id: R_10.05.004_mining
    description: '광업 — A-Q2 mining'
    condition: "axis.work_env == 'mining'"
    segment: mining
    severity: MUST

  - id: R_10.05.005_infrastructure
    description: '인프라·대형 건설 — A-Q2 infrastructure'
    condition: "axis.work_env == 'infrastructure'"
    segment: infrastructure
    severity: MUST

  - id: R_10.05.006_agri_plantation
    description: '농업·플랜테이션 — A-Q2 agri_plantation'
    condition: "axis.work_env == 'agri_plantation'"
    segment: agri_plantation
    severity: MUST

  - id: R_10.05.007_quarry
    description: '채석장 — A-Q2 quarry'
    condition: "axis.work_env == 'quarry'"
    segment: quarry
    severity: MUST

  - id: R_10.05.008_gov_public
    description: '정부·공공 — A-Q2 gov_public'
    condition: "axis.work_env == 'gov_public'"
    segment: gov_public
    severity: MUST

  # ---------- 2차 (S2) — work_env 미응답 시 fleet+budget+role 조합 fallback ----------
  - id: R_10.05.020_kacc_by_budget_role
    description: 'budget XL 또는 (fleet XL + executive) → key_account fallback'
    condition: "axis.annual_budget == 'XL' OR (axis.fleet_size == 'XL' AND axis.role == 'executive')"
    segment: key_account
    severity: SHOULD

  - id: R_10.05.021_fleet_rental_by_size
    description: 'fleet 20대+ → fleet_rental fallback'
    condition: "axis.fleet_size in ['L', 'XL']"
    segment: fleet_rental
    severity: SHOULD

  - id: R_10.05.022_mining_legacy_usage
    description: 'legacy axis.usage=mining 호환 — survey_v1_dealer 대비'
    condition: "axis.usage == 'mining'"
    segment: mining
    severity: SHOULD

  - id: R_10.05.023_infra_legacy_usage
    description: 'legacy axis.usage=construction_heavy → infrastructure 매핑'
    condition: "axis.usage == 'construction_heavy'"
    segment: infrastructure
    severity: SHOULD

  - id: R_10.05.024_agri_legacy_usage
    description: 'legacy axis.usage in [agriculture, forestry] → agri_plantation 매핑'
    condition: "axis.usage in ['agriculture', 'forestry']"
    segment: agri_plantation
    severity: SHOULD

  - id: R_10.05.025_fleet_rental_legacy_usage
    description: 'legacy axis.usage=rental → fleet_rental 매핑'
    condition: "axis.usage == 'rental'"
    segment: fleet_rental
    severity: SHOULD

  # ---------- 기본값 (S3) ----------
  - id: R_10.05.099_individual_default
    description: '미해당 시 individual default (구 other 대체)'
    condition: 'default'
    segment: individual
    severity: MAY

voice_segment_labels:
  individual:
    ko: '개인 사업자'
    ru: 'Индивидуальный предприниматель'
    en: 'Individual'
  fleet_rental:
    ko: '플릿·렌탈'
    ru: 'Парк / аренда'
    en: 'Fleet / Rental'
  key_account:
    ko: '키 어카운트'
    ru: 'Ключ. клиент'
    en: 'Key Account'
  mining:
    ko: '광업'
    ru: 'Горнодобыча'
    en: 'Mining'
  infrastructure:
    ko: '인프라·대형 건설'
    ru: 'Инфраструктура'
    en: 'Infrastructure'
  agri_plantation:
    ko: '농업·플랜테이션'
    ru: 'С/х · плантация'
    en: 'Agri / Plantation'
  quarry:
    ko: '채석장'
    ru: 'Карьер'
    en: 'Quarry'
  gov_public:
    ko: '정부·공공'
    ru: 'Гос. сектор'
    en: 'Government / Public'

sensor_screen:
  source: 'crm_url_path'
  default_crm: 'bitrix24'
  fallback_classifier: 'crm_screen_identifier'

  bitrix24_patterns:
    - screen: deal_detail
      url_regex: '/crm/deal/details/'
    - screen: deal_list
      url_regex: '/crm/deal/'
    - screen: company
      url_regex: '/crm/company/details/'
    - screen: contact
      url_regex: '/crm/contact/details/'
    - screen: activity
      url_regex: '/crm/activity/'
    - screen: funnel
      url_regex: '/crm/funnel/'
    - screen: task
      url_regex: '/crm/task/'

lead_priority:
  - id: R_10.05.101_p1
    description: 'score >= 85 → P1 즉시'
    condition: 'score >= 85'
    priority: P1
    severity: MUST

  - id: R_10.05.102_p2
    description: 'score 70~84 → P2'
    condition: 'score >= 70 AND score < 85'
    priority: P2
    severity: MUST

  - id: R_10.05.103_p3
    description: 'score 55~69 → P3'
    condition: 'score >= 55 AND score < 70'
    priority: P3
    severity: MUST

  - id: R_10.05.104_p4
    description: 'score 40~54 → P4'
    condition: 'score >= 40 AND score < 55'
    priority: P4
    severity: MUST

  - id: R_10.05.105_p5
    description: 'score < 40 → P5'
    condition: 'score < 40'
    priority: P5
    severity: MUST
$yaml$,
    NULL,
    'system_migration',
    '037 — R_10.05 v2 — CTT 8 segment 재정의 (work_env 직접 매핑 + fleet/budget/role fallback)'
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
    WHERE rule_id = 'R_10.05_Classification' AND status = 'active' AND version = '2026-05-25.001';
  IF _active_count != 1 THEN
    RAISE EXCEPTION '037 verification failed: R_10.05 v2 active count = % (expected 1)', _active_count;
  END IF;
END
$verify$;
