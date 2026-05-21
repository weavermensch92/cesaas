-- 034_save_response_dw_args.sql
-- DW 6축 간접 추론 와이어링: save_response RPC에 p_dw_raw_answers·p_dw_extraction 인자 추가.
-- 031에서 responses.dw_raw_answers / dw_extraction 컬럼은 이미 ADD COLUMN — 본 마이그레이션은 RPC만 확장.
--
-- 029_drop_old_save_response.sql 패턴 답습 — 옛 시그니처(025의 23-param) 명시적 DROP 후 25-param 신규 정의.
-- PostgreSQL function resolution은 같은 이름·다른 시그니처 공존 시 후보 모호 → 옛 것 DROP 필수.
--
-- Edge Function (responses-receive)은 두 가지 모드:
--   1) 직접 — preference_axes 동봉 (Dealer v2 현행). dw_raw_answers·dw_extraction = NULL.
--   2) 간접 추론 — dw_raw_answers 동봉 → handler가 computeDw() 산출 → preference_axes 채움.
--      dw_extraction = { method, rule_version, llm_run_id, llm_confidence }.

-- ============================================================================
-- 1. 옛 시그니처 DROP (025 23-param)
-- ============================================================================
DROP FUNCTION IF EXISTS public.save_response(
  TEXT,         -- p_survey_id
  TEXT,         -- p_respondent_type
  TEXT,         -- p_dealer_id
  TEXT,         -- p_device_id
  TEXT,         -- p_event
  TEXT,         -- p_language
  INT,          -- p_nps
  BOOLEAN,      -- p_future_subscription
  BOOLEAN,      -- p_consent
  TEXT,         -- p_segment
  TEXT,         -- p_segment_method
  REAL,         -- p_segment_conf
  JSONB,        -- p_axis_data
  JSONB,        -- p_answers
  TIMESTAMPTZ,  -- p_captured_at
  TEXT,         -- p_contact_name
  TEXT,         -- p_contact_phone
  TEXT,         -- p_contact_email
  TEXT,         -- p_notes
  BOOLEAN,      -- p_contact_opted_in
  TEXT,         -- p_target_company
  JSONB,        -- p_preference_axes
  TEXT          -- p_dealer_hypothesis_segment
);

-- ============================================================================
-- 2. 신규 시그니처 — p_dw_raw_answers·p_dw_extraction 추가
-- ============================================================================
CREATE OR REPLACE FUNCTION save_response(
  p_survey_id           TEXT,
  p_respondent_type     TEXT,
  p_dealer_id           TEXT,
  p_device_id           TEXT,
  p_event               TEXT,
  p_language            TEXT,
  p_nps                 INT,
  p_future_subscription BOOLEAN,
  p_consent             BOOLEAN,
  p_segment             TEXT,
  p_segment_method      TEXT,
  p_segment_conf        REAL,
  p_axis_data           JSONB,
  p_answers             JSONB,
  p_captured_at         TIMESTAMPTZ,
  p_contact_name        TEXT    DEFAULT NULL,
  p_contact_phone       TEXT    DEFAULT NULL,
  p_contact_email       TEXT    DEFAULT NULL,
  p_notes               TEXT    DEFAULT NULL,
  p_contact_opted_in    BOOLEAN DEFAULT FALSE,
  p_target_company      TEXT    DEFAULT NULL,
  p_preference_axes     JSONB   DEFAULT NULL,
  p_dealer_hypothesis_segment TEXT DEFAULT NULL,
  p_dw_raw_answers      JSONB   DEFAULT NULL,
  p_dw_extraction       JSONB   DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _resp_id UUID;
  _ans     JSONB;
BEGIN
  INSERT INTO responses (
    survey_id, respondent_type, dealer_id, device_id, event, language,
    nps, future_subscription, consent_data_collection,
    segment, segment_method, segment_confidence, axis_data,
    captured_at, source,
    contact_name, contact_phone, contact_email, notes, contact_opted_in,
    target_company, preference_axes, dealer_hypothesis_segment,
    dw_raw_answers, dw_extraction
  ) VALUES (
    p_survey_id, p_respondent_type, p_dealer_id, p_device_id, p_event, COALESCE(p_language, 'ru'),
    p_nps, p_future_subscription, p_consent,
    p_segment, p_segment_method, p_segment_conf, p_axis_data,
    p_captured_at, p_respondent_type::source_t,
    p_contact_name, p_contact_phone, p_contact_email, p_notes, p_contact_opted_in,
    p_target_company, p_preference_axes, p_dealer_hypothesis_segment,
    p_dw_raw_answers, p_dw_extraction
  )
  RETURNING id INTO _resp_id;

  IF p_answers IS NOT NULL THEN
    FOR _ans IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
      INSERT INTO response_answers (response_id, question_id, answer)
      VALUES (
        _resp_id,
        _ans ->> 'question_id',
        _ans -> 'answer'
      )
      ON CONFLICT (response_id, question_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN _resp_id;
END;
$$;

-- ============================================================================
-- 3. 검증 — save_response 시그니처가 정확히 1개(25-param 신규)인지
-- ============================================================================
DO $verify$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'save_response'
    AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '034 verification failed: save_response 시그니처 수 = % (1이어야 함)', v_count;
  END IF;
  RAISE NOTICE '034 — save_response 25-param 신규 시그니처 정착 완료';
END
$verify$;
