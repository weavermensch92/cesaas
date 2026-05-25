-- 044_seed_r10_06_voice_text_translate.sql
-- R_10.06 PromptTemplates v3 — voice_text_translate 템플릿 추가.
--
-- 변경 요지 (vs 041):
--   1) 기존 4개 템플릿(sensor_13_fields · sensor_screen_classify · voice_studio_survey_build ·
--      segment_classifier) 전부 보존.
--   2) 신규 5번째 voice_text_translate (Claude Haiku) — 자유 텍스트 응답을 ko/en/ru 동시 번역.
--      출력: JSON {ko, en, ru}. 다른 텍스트·markdown fence 금지.
--   3) multi_image_guide 유지.
--
-- 호출:
--   voice-translate-worker Edge Function (045 큐 처리)이 callRule('R_10.06_PromptTemplates',
--   'voice_text_translate', { vars: {text, source_lang} }) 형식으로 호출.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.06_PromptTemplates',
    '2026-05-25.002',
    $yaml$rule_id: R_10.06_PromptTemplates
version: 3
description: 'LLM 프롬프트 (Sensor 13 필드·화면 분류·Studio 빌드·CTT 8 segment 분류기·자유 텍스트 번역)'
harness: 2
v1_v2: v2
status: active
last_modified: '2026-05-25T00:00:00Z'
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
      선택 axis: funding · expansion. 8 segment(individual·fleet_rental·key_account·mining·
      infrastructure·agri_plantation·quarry·gov_public) 중 어느 segment를 변별할 의도인지 명시.
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
      당신은 HD건설기계 CTT 2026 영업 segment 분류기다.
      6 axis + 작업환경(work_env) 응답을 보고 가장 적합한 segment 1개를 반환한다.
      가능한 값: individual · fleet_rental · key_account · mining · infrastructure · agri_plantation · quarry · gov_public.

      판정 우선순위:
      1) axis.work_env 명시 시 직접 매핑:
         - individual_owner → individual
         - fleet_rental → fleet_rental
         - large_corporate → key_account
         - mining → mining
         - infrastructure → infrastructure
         - agri_plantation → agri_plantation
         - quarry → quarry
         - gov_public → gov_public
      2) work_env 미명시 시 다음 조합 추론:
         - axis.annual_budget == 'XL' 또는 (axis.fleet_size == 'XL' AND axis.role == 'executive') → key_account
         - axis.fleet_size in ['L','XL'] → fleet_rental
         - legacy axis.usage == 'mining' → mining
         - legacy axis.usage == 'construction_heavy' → infrastructure
         - legacy axis.usage in ['agriculture','forestry'] → agri_plantation
         - legacy axis.usage == 'rental' → fleet_rental
         - 광업·골재·시멘트·터널 키워드 → mining
         - 인프라·고속도로·교량·공항·항만 → infrastructure
         - 농지·과수원·플랜테이션·축산 → agri_plantation
         - 채석장·골재 채취 → quarry
         - 시·도·지자체·공공·국방 → gov_public
         - 그 외 소규모(fleet S, 예산 XS/S) → individual

      출력: JSON 한 덩어리 {"segment": "<value>", "confidence": 0.0~1.0}. 다른 텍스트·markdown fence 금지.
    user: |
      6 axis + work_env 응답:
      {axis_json}

      위 응답으로 segment 분류. JSON만.

  voice_text_translate:
    id: R_10.06.005
    model: claude-haiku-4-5-20251001
    max_tokens: 800
    temperature: 0
    system: |
      당신은 HD건설기계 PoC 응답 번역기다.
      자유 텍스트 1개를 입력받아 ko·en·ru 3개 언어로 동시 번역한다.

      규칙:
      - 원본 의도·뉘앙스 유지. 의역 가능하지만 정보 추가·요약 금지.
      - 고유명사(회사·브랜드·도시)는 원어 보존. 기술 용어는 해당 언어 업계 표준 표기 사용.
      - 빈 텍스트·의미 없는 입력은 동일 텍스트 그대로 3언어에 복사.
      - 출력은 valid JSON 한 덩어리 {"ko":"...","en":"...","ru":"..."}. 설명·markdown fence 금지.
    user: |
      원본 언어: {source_lang}
      원문:
      """
      {text}
      """

      JSON만 반환.

multi_image_guide:
  max_images: 5
  ordering: chronological
  diversification: true
$yaml$,
    NULL,
    'system_migration',
    '044 — R_10.06 v3 — voice_text_translate 템플릿 추가 (Claude Haiku, ko/en/ru 동시 번역)'
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
    WHERE rule_id = 'R_10.06_PromptTemplates' AND status = 'active' AND version = '2026-05-25.002';
  IF _active_count != 1 THEN
    RAISE EXCEPTION '044 verification failed: R_10.06 v3 active count = % (expected 1)', _active_count;
  END IF;
END
$verify$;
