-- 024_seed_r10_08_survey_builder.sql
-- R_10.08 SurveyBuildPrompt 시드 — DB rule_versions row 발급.
-- C_Common/r_10_rules/R_10.08_SurveyBuildPrompt.yaml 와 동기화.
--
-- 현재 V_60 Studio 운영은 R_10.06.voice_studio_survey_build 호출 — 본 룰은 Phase D에서 본 파일로 이전 예정.
-- 본 시드로 rule_versions 에 row 존재 → loadRule('R_10.08_SurveyBuildPrompt') 가능.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.08_SurveyBuildPrompt',
    '2026-05-19.001',
    $yaml$rule_id: R_10.08_SurveyBuildPrompt
version: 1
description: 'Studio 자연어 → 설문 JSON 빌드 prompt template + Studio 전용 schema/validation'
harness: 2
v1_v2: v1
status: active
last_modified: '2026-05-19T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

templates:
  survey_builder:
    id: R_10.08.001
    model: claude-opus-4-7
    max_tokens: 4000
    temperature: 0
    system: |
      당신은 HD건설기계 영업 설문 빌더이다.
      자연어 요구를 받아 6 axis(설문 분류축) 기반의 설문 정의(JSON)를 생성한다.
      필수 axis: scale · usage · budget · timeline.
      선택 axis: funding · expansion. 8 segment 중 어느 segment를 변별할 의도인지 명시.
      출력 JSON만. 설명 텍스트·markdown fence 금지.
    user: |
      아래 자연어 요청에 맞는 설문 정의를 R_10.05 Classification 스키마와 호환되도록 JSON으로 작성하라.

      ## Studio target schema
      audience: dealer | visitor
      language: ko / ru / en
      duration_minutes_max: {duration_minutes_max}
      question_kinds: single_select · multi_select · scale_1_10 · nps · text_short · text_long · consent

      ## Validation
      - NPS(0~10) 1개 필수
      - 향후 수신 동의 consent 1개 필수
      - Visitor 18문항 중 핵심 4 axis(scale·usage·budget·timeline) 필수 매핑

      ## 요청
      {input}

output_schema:
  example: |
    {
      "id": "survey_<auto>",
      "title": "string",
      "audience": "dealer | visitor",
      "language_default": "ru",
      "languages_available": ["ru", "en", "ko"],
      "duration_minutes_estimate": 2,
      "questions": [
        {
          "id": "q_<auto>",
          "type": "single_select",
          "axis": "scale",
          "title_ru": "string",
          "title_en": "string (optional)",
          "title_ko": "string (optional)",
          "options": [{ "value": "S", "label_ru": "string" }],
          "required": true
        }
      ]
    }

target_schema:
  surveys:
    audience: [dealer, visitor]
    language: [ko, ru, en]
    duration_minutes_max: 2
  question_kinds:
    - single_select
    - multi_select
    - scale_1_10
    - nps
    - text_short
    - text_long
    - consent

validation_rules:
  - 'NPS(0~10) 1개 필수'
  - '향후 수신 동의 consent 1개 필수'
  - 'Visitor 18문항 중 핵심 4 axis 필수 매핑'
  - '핵심 4 axis: scale·usage·budget·timeline'

defaults:
  language_primary: ru
  fallback_languages: [ko, en]
  dealer_question_count_target: 31
  visitor_question_count_target: 18

llm_call:
  rule: R_10.06_PromptTemplates
  prompt_key: voice_studio_survey_build
$yaml$,
    NULL,
    'system_migration',
    '024 — R_10.08 SurveyBuildPrompt 시드 발급 (YAML과 동기)'
  );
END
$migration$;
