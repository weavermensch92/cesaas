-- 046_dealer_v1_2026rev_multi_other_inline.sql
-- 042의 multi_select "other" 옵션에 `is_other:true` 메타 추가 — v1rev 클라이언트가 inline textarea를 노출하도록.
--
-- 대상: q_v1d26_factors / q_v1d26_channels / q_v1d26_service_expect의 "other" value.
-- 폐기 대상 아님 — q_v1d26_factors_other / _channels_other / _service_expect_other text_short question은 그대로 둠
-- (UI는 dependsOn으로 hidden 처리, payload는 q.id + '_other'로 매핑되어 FK 안전).

BEGIN;

-- q_v1d26_factors: "other" 옵션에 is_other:true
UPDATE survey_questions SET options = (
  SELECT jsonb_agg(
    CASE WHEN opt->>'value' = 'other'
         THEN opt || '{"is_other": true}'::jsonb
         ELSE opt
    END
  )
  FROM jsonb_array_elements(options) AS opt
)
WHERE id = 'q_v1d26_factors' AND survey_id = 'survey_v1_dealer_2026rev';

-- q_v1d26_channels
UPDATE survey_questions SET options = (
  SELECT jsonb_agg(
    CASE WHEN opt->>'value' = 'other'
         THEN opt || '{"is_other": true}'::jsonb
         ELSE opt
    END
  )
  FROM jsonb_array_elements(options) AS opt
)
WHERE id = 'q_v1d26_channels' AND survey_id = 'survey_v1_dealer_2026rev';

-- q_v1d26_service_expect
UPDATE survey_questions SET options = (
  SELECT jsonb_agg(
    CASE WHEN opt->>'value' = 'other'
         THEN opt || '{"is_other": true}'::jsonb
         ELSE opt
    END
  )
  FROM jsonb_array_elements(options) AS opt
)
WHERE id = 'q_v1d26_service_expect' AND survey_id = 'survey_v1_dealer_2026rev';

-- q_v1d26_competitor_brands — "other" 옵션도 inline textarea로 (보너스: 사용자가 명시 안 했지만 일관성)
UPDATE survey_questions SET options = (
  SELECT jsonb_agg(
    CASE WHEN opt->>'value' = 'other'
         THEN opt || '{"is_other": true}'::jsonb
         ELSE opt
    END
  )
  FROM jsonb_array_elements(options) AS opt
)
WHERE id = 'q_v1d26_competitor_brands' AND survey_id = 'survey_v1_dealer_2026rev';

-- 검증 — 4개 question의 "other" 옵션에 is_other=true 매치
DO $verify$
DECLARE
  _matched INT;
BEGIN
  SELECT COUNT(*) INTO _matched
  FROM survey_questions q,
       jsonb_array_elements(q.options) AS opt
  WHERE q.survey_id = 'survey_v1_dealer_2026rev'
    AND q.id IN ('q_v1d26_factors', 'q_v1d26_channels', 'q_v1d26_service_expect', 'q_v1d26_competitor_brands')
    AND opt->>'value' = 'other'
    AND (opt->>'is_other')::boolean = true;
  IF _matched != 4 THEN
    RAISE EXCEPTION '046 verification failed: is_other:true on "other" options = % (expected 4)', _matched;
  END IF;
END
$verify$;

COMMIT;
