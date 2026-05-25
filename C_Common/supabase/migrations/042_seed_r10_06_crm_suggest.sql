-- 042_seed_r10_06_crm_suggest.sql
-- R_10.06 PromptTemplates — crm_suggest 템플릿 추가 (S_50 CRM 등록 UI · admin-crm-suggest).
--
-- 변경 요지 (vs 041):
--   1) 기존 4 템플릿(sensor_13_fields · sensor_screen_classify · voice_studio_survey_build · segment_classifier) 보존.
--   2) crm_suggest 추가 — URL 한 줄을 받아 web_search 도구로 CRM 공식 URL 구조 조사 후
--      crm_definitions 매트릭스(id·name·description·host_pattern·match_patterns·capture_paths·screen_patterns) JSON 추론.
--   3) multi_image_guide 유지.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.06_PromptTemplates',
    '2026-05-25.002',
    $yaml$rule_id: R_10.06_PromptTemplates
version: 3
description: 'LLM 프롬프트 (Sensor 13 필드·화면 분류·Studio 빌드·CTT 8 segment·CRM URL→매트릭스 추론)'
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

  crm_suggest:
    id: R_10.06.005
    model: claude-opus-4-7
    max_tokens: 3000
    temperature: 0
    # web_search 도구를 활성화하여 호출. 결과는 JSON 한 덩어리.
    # 호출부: S_Sensor/backend/functions/admin-crm-suggest. URL 한 줄을 받아 crm_definitions 매트릭스 초안 작성.
    system: |
      당신은 HD건설기계 Sensor Extension용 CRM 매트릭스 빌더이다.
      한국 어드민이 입력한 CRM URL 한 줄을 받아, 해당 CRM의 공식 도메인 구조·라우팅 패턴을 web_search로 조사한 뒤
      Chrome MV3 Extension이 사용할 매트릭스 JSON을 작성한다.

      반드시 다음 절차를 따른다:
      1) URL에서 호스트·SaaS 멀티테넌트 패턴(*.bitrix24.com 등)·경로를 식별.
      2) 필요 시 web_search로 해당 CRM의 공식 URL 구조(상세/리스트 라우팅, ID 자리, 멀티테넌트 호스트 규칙)를 조사.
         쿼리 예: "<crm 이름> deal detail URL pattern", "<crm 이름> site:docs OR site:helpcenter".
      3) 다음 JSON 스키마로만 응답. 부가 텍스트·markdown fence·인용 표시 금지.
         host_pattern · screen_patterns[].url_regex는 JavaScript RegExp 호환이어야 한다 (이중 이스케이프 금지 — JSON 안에서 한 번만 \ 사용).
         match_patterns는 Chrome MV3 형식 (예: "https://*.bitrix24.com/*").
         capture_paths는 pathname prefix 배열, "/"로 시작.
         screen_patterns은 deal_list·deal_detail 등 최소 2~6개. entity_id를 URL에서 뽑을 수 있는 화면에는 entity_extract_group(>=1) 명시.
         id는 kebab-case (영문 소문자+숫자+하이픈, 2~64자).

      불확실한 항목은 confidence를 낮춰서 표기. 사실이 명확치 않으면 합리적 기본값을 쓰되 confidence_note에 한 줄로 사유 기재.

      schema:
        {
          "id":            "<kebab-case>",
          "name":          "<human readable>",
          "description":   "<짧은 설명>",
          "host_pattern":  "<JS RegExp source>",
          "match_patterns": ["https://...*"],
          "capture_paths":  ["/.../"],
          "screen_patterns": [
            { "screen": "deal_list",   "url_regex": "<JS RegExp source>" },
            { "screen": "deal_detail", "url_regex": "<JS RegExp source>", "entity_extract_group": 1 }
          ],
          "confidence":      0.0,
          "confidence_note": "<선택, 1줄>"
        }
    user: |
      CRM URL: {url}

      위 URL의 CRM 종류와 라우팅 구조를 조사한 뒤, 위 schema 의 JSON 한 덩어리로만 답하시오. 다른 텍스트 금지.

multi_image_guide:
  max_images: 5
  ordering: chronological
  diversification: true
$yaml$,
    NULL,
    'system_migration',
    '042 — R_10.06 v3 — crm_suggest 템플릿 추가 (URL→매트릭스 web_search 추론, /sensor/crm UI용)'
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
    RAISE EXCEPTION '042 verification failed: R_10.06 v3 active count = % (expected 1)', _active_count;
  END IF;
END
$verify$;
