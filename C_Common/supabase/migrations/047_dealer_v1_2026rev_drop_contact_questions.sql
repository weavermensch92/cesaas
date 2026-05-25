-- 047_dealer_v1_2026rev_drop_contact_questions.sql
-- 위버 지적: 회사명·담당자·연락처는 좌측 sidebar 공통 입력으로 받음. 우측 본문 정식 question 3개는 폐기.
--
-- 폐기 대상 (survey_v1_dealer_2026rev):
--   q_v1d26_target_company  (sort_order=1)
--   q_v1d26_contact_name    (sort_order=2)
--   q_v1d26_contact_phone   (sort_order=3)
--
-- payload.target_company / contact_name / contact_phone는 좌측 sidebar input 값으로 직접 송출되므로 DB 호환성 보존.
-- response_answers 기존 row 있으면 ON DELETE CASCADE로 함께 제거 (FK on survey_questions(id)).
--
-- 검증: question count 26 → 23 변경.

BEGIN;

DELETE FROM survey_questions
 WHERE survey_id = 'survey_v1_dealer_2026rev'
   AND id IN ('q_v1d26_target_company', 'q_v1d26_contact_name', 'q_v1d26_contact_phone');

DO $verify$
DECLARE
  _count INT;
BEGIN
  SELECT COUNT(*) INTO _count FROM survey_questions WHERE survey_id = 'survey_v1_dealer_2026rev';
  IF _count != 23 THEN
    RAISE EXCEPTION '047 verification failed: survey_v1_dealer_2026rev question count = % (expected 23 after dropping 3 contact questions)', _count;
  END IF;
END
$verify$;

COMMIT;
