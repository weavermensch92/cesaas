-- 023_reseed_r10_06_segment_classifier.sql
-- R_10.06 PromptTemplates 시드를 segment_classifier 템플릿 추가본으로 갱신 (V-004).
--
-- 변경 요지:
--   - 기존 3 템플릿(sensor_13_fields·sensor_screen_classify·voice_studio_survey_build) 유지
--   - 신규 segment_classifier 추가 — Claude Haiku 분류기 (axis_json → segment + confidence)
--
-- 호출부:
--   V_Voice/backend/shared/segments.ts: deterministic이 'other' 반환 시 callRule('R_10.06_PromptTemplates','segment_classifier',{axis_json}) LLM fallback.
--   비용 최소화 — Haiku 사용 + axis가 의미 있는 데이터일 때만 fire.
--
-- 이전: 018·022 마이그레이션이 R_10.06 시드. 본 마이그레이션이 active 갱신.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.06_PromptTemplates',
    '2026-05-20.001',
    $yaml$rule_id: R_10.06_PromptTemplates
version: 1
description: 'LLM 호출 시스템·user 프롬프트 (Sensor 13 필드·화면 분류·Studio 빌드·Segment 분류기)'
harness: 2
v1_v2: v1
status: active
last_modified: '2026-05-20T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

templates:
  sensor_13_fields:
    id: R_10.06.001
    model: claude-opus-4-7
    max_tokens: 2000
    temperature: 0
    system: |
      당신은 HD건설기계의 러시아 영업 깔때기 데이터 추출 어시스턴트이다.
      Bitrix24 CRM 스크린샷 1~5장을 받아 동일 deal의 13개 표준 필드를 JSON으로 반환한다.
      모르는 값은 null. 추측 금지. 회사명·연락처에서 추론한 가치 판단도 금지.
      출력은 반드시 valid JSON 한 덩어리. 설명 텍스트·markdown fence 금지.
      각 필드에 confidence(0.0~1.0)도 동시에 산출 — 시각 인식 신뢰도이지 사실 확신도가 아님.
    user: |
      아래 1~5장의 스크린샷은 동일한 deal entity의 여러 화면이다.
      아래 schema 에 맞춰 정확히 키 13개 + confidence 객체로 JSON 작성.

      schema:
        {
          "deal_id":            string | null,
          "deal_code":          string | null,
          "company_name":       string | null,
          "contact_name":       string | null,
          "contact_phone":      string | null,
          "contact_email":      string | null,
          "amount":             number | null,
          "currency":           string | null,
          "stage":              string | null,
          "product_model":      string | null,
          "region":             string | null,
          "date_created":       string | null,
          "responsible_dealer": string | null,
          "confidence": {
            "deal_id":            0.0~1.0,
            "deal_code":          0.0~1.0,
            "company_name":       0.0~1.0,
            "contact_name":       0.0~1.0,
            "contact_phone":      0.0~1.0,
            "contact_email":      0.0~1.0,
            "amount":             0.0~1.0,
            "stage":              0.0~1.0,
            "product_model":      0.0~1.0,
            "region":             0.0~1.0,
            "date_created":       0.0~1.0,
            "responsible_dealer": 0.0~1.0
          }
        }

  sensor_screen_classify:
    id: R_10.06.002
    model: claude-opus-4-7
    max_tokens: 200
    temperature: 0
    system: |
      스크린샷 1장을 보고 Bitrix24 화면 종류 1개를 반환한다.
      가능한 값: deal_list · deal_detail · company · contact · activity · funnel · task · unknown.
      반환 형식: {"kind": "<value>", "confidence": 0.0~1.0}.
    user: |
      아래 이미지의 화면 종류를 위 enum에서 하나 골라라.

  voice_studio_survey_build:
    id: R_10.06.003
    model: claude-opus-4-7
    max_tokens: 4000
    temperature: 0
    system: |
      당신은 HD건설기계 영업 설문 빌더이다.
      자연어 요구를 받아 6 axis(설문 분류축) 기반의 설문 정의(JSON)를 생성한다.
      필수 axis: scale · usage · budget · timeline.
      선택 axis: funding · expansion. 8 segment 중 어느 segment를 변별할 의도인지 명시.
    user: |
      아래 자연어 요청에 맞는 설문 정의를 R_10.05 Classification 스키마와 호환되도록 JSON으로 작성하라.
      요청:
      {input}

  segment_classifier:
    id: R_10.06.004
    model: claude-haiku-4-5-20251001
    max_tokens: 200
    temperature: 0
    system: |
      당신은 HD건설기계 영업 segment 분류기다.
      6 axis 응답 데이터를 보고 가장 적합한 segment 1개를 반환한다.
      가능한 값: mining · key_account · construction_heavy · agriculture · forestry · general_construction · rental · other.
      판정 기준:
      - 광업·골재·시멘트 등 heavy duty → mining
      - 연 거래액 'large' 또는 fleet 50대+ → key_account
      - 큰 건설 현장(고층·인프라) + 중대형 장비 → construction_heavy
      - 농업·축산 → agriculture
      - 임업·산림 → forestry
      - 일반 중소 건설 → general_construction
      - 렌탈·임대업 → rental
      - 위 어디에도 명확히 안 맞으면 'other'.
      출력: JSON 한 덩어리 {"segment": "<value>", "confidence": 0.0~1.0}. 다른 텍스트·markdown fence 금지.
    user: |
      6 axis 응답:
      {axis_json}

      위 응답으로 segment 분류. JSON만.

multi_image_guide:
  max_images: 5
  ordering: chronological
  diversification: true
$yaml$,
    NULL,
    'system_migration',
    '023 — R_10.06 reseed: segment_classifier (Haiku, V-004 LLM fallback) 추가'
  );
END
$migration$;
