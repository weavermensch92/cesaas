-- 025_dealer_v2_preference_axes.sql
-- Dealer v2 (와이어프레임 기반 3-column UI) 데이터 모델 확장.
-- 1) preference_axes JSONB — 6 가치축 (Price·Fuel·Durability·Service·Reference·Versatility) 1~5 score
-- 2) dealer_hypothesis_segment TEXT — 딜러가 인터뷰 중 가설로 토글한 R_10.05 segment 라벨
--    (server-side classifyServerSide 자동 분류와 별개. 가설 vs 자동분류 비교로 인터뷰 정확도 측정)

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS preference_axes         JSONB,
  ADD COLUMN IF NOT EXISTS dealer_hypothesis_segment TEXT;

COMMENT ON COLUMN responses.preference_axes IS
  '딜러 v2 가치 평가 6축 score: {"price":1-5,"fuel":1-5,"durability":1-5,"service":1-5,"reference":1-5,"versatility":1-5}';
COMMENT ON COLUMN responses.dealer_hypothesis_segment IS
  '딜러가 인터뷰 중 가설로 선택한 segment. 자동 분류(segment 컬럼)와 비교 → 인터뷰 정확도 분석.';

-- ----------------------------------------------------------------------------
-- save_response RPC 확장
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
  p_target_company      TEXT    DEFAULT NULL,
  p_preference_axes     JSONB   DEFAULT NULL,
  p_dealer_hypothesis_segment TEXT DEFAULT NULL
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
    target_company, preference_axes, dealer_hypothesis_segment
  ) VALUES (
    p_survey_id, p_respondent_type, p_dealer_id, p_device_id, p_event, COALESCE(p_language, 'ru'),
    p_nps, p_future_subscription, p_consent,
    p_segment, p_segment_method, p_segment_conf, p_axis_data,
    p_captured_at, p_respondent_type::source_t,
    p_contact_name, p_contact_phone, p_contact_email, p_notes, p_contact_opted_in,
    p_target_company, p_preference_axes, p_dealer_hypothesis_segment
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
