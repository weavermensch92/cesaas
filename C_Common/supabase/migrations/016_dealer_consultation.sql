-- 016_dealer_consultation.sql
-- 딜러가 자기 페이지에서 상담 끝난 뒤 응답을 기록하는 흐름.
-- 각 응답이 어느 고객(회사)에 대한 것인지 추적하기 위해 target_company 컬럼 추가.
-- contact_name/phone/notes 는 이미 009 에서 추가됨 — 딜러가 채울 때는 "고객측 담당자" 로 의미 전환.

-- ----------------------------------------------------------------------------
-- 1. target_company
-- ----------------------------------------------------------------------------
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS target_company TEXT;

COMMENT ON COLUMN responses.target_company IS '딜러 응답일 때 상담 대상 회사명. Visitor 응답은 NULL.';

-- 딜러 본인 history view 인덱스
CREATE INDEX IF NOT EXISTS responses_dealer_captured_idx
  ON responses(dealer_id, captured_at DESC) WHERE dealer_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. save_response RPC — target_company 인자 추가 (기존 시그니처 호환)
-- ----------------------------------------------------------------------------
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
  p_target_company      TEXT    DEFAULT NULL
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
    target_company
  ) VALUES (
    p_survey_id, p_respondent_type, p_dealer_id, p_device_id, p_event, COALESCE(p_language, 'ru'),
    p_nps, p_future_subscription, p_consent,
    p_segment, p_segment_method, p_segment_conf, p_axis_data,
    p_captured_at, p_respondent_type::source_t,
    p_contact_name, p_contact_phone, p_contact_email, p_notes, p_contact_opted_in,
    p_target_company
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

-- ----------------------------------------------------------------------------
-- 3. 딜러 본인 history view RPC — auth.uid() 와 무관하게 dealer_id 기반
--    (Bearer JWT 의 sub=dealer_id 와 매칭. responses-receive 와 동일 origin)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_dealer_consultations(p_dealer_id TEXT, p_limit INT DEFAULT 50)
RETURNS TABLE(
  id              UUID,
  captured_at     TIMESTAMPTZ,
  target_company  TEXT,
  contact_name    TEXT,
  contact_phone   TEXT,
  segment         TEXT,
  nps             INT,
  notes           TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT id, captured_at, target_company, contact_name, contact_phone, segment, nps, notes
  FROM responses
  WHERE dealer_id = p_dealer_id
  ORDER BY captured_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION list_dealer_consultations(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_dealer_consultations(TEXT, INT) TO service_role;
