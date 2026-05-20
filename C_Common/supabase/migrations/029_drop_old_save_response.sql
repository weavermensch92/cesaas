-- ============================================================================
-- 029_drop_old_save_response.sql
-- save_response RPC가 두 시그니처로 존재해 PostgreSQL function resolution 실패.
-- 025가 새 시그니처(+ preference_axes, dealer_hypothesis_segment)를 CREATE OR REPLACE 했지만
-- 옛 시그니처(016/009)는 그대로 살아있음. 옛 시그니처를 명시적으로 DROP.
--
-- 증상: responses-receive Edge Function → "Could not choose the best candidate function"
-- 영향: visitor 응답 100% 500 fail.
-- ============================================================================

DROP FUNCTION IF EXISTS public.save_response(
  TEXT,        -- p_survey_id
  TEXT,        -- p_respondent_type
  TEXT,        -- p_dealer_id
  TEXT,        -- p_device_id
  TEXT,        -- p_event
  TEXT,        -- p_language
  INT,         -- p_nps
  BOOLEAN,     -- p_future_subscription
  BOOLEAN,     -- p_consent
  TEXT,        -- p_segment
  TEXT,        -- p_segment_method
  REAL,        -- p_segment_conf
  JSONB,       -- p_axis_data
  JSONB,       -- p_answers
  TIMESTAMPTZ, -- p_captured_at
  TEXT,        -- p_contact_name
  TEXT,        -- p_contact_phone
  TEXT,        -- p_contact_email
  TEXT,        -- p_notes
  BOOLEAN,     -- p_contact_opted_in
  TEXT         -- p_target_company
);

-- 검증 — 남은 시그니처가 정확히 1개(025의 23-param 버전)인지 확인
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'save_response'
    AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'save_response 잔존 시그니처 수 = % (1이어야 함)', v_count;
  END IF;
  RAISE NOTICE 'save_response 시그니처 정리 완료 — 1개 남음';
END $$;
