-- 048_usage_hier_multi_select.sql
-- q_v1d26_usage_hier: single_select → multi_select 변경.
-- CTT Expo 방문 제품 분야는 한 회사가 여러 분야 동시 관심 가능 → 다중 선택.
--
-- 옵션 메타(level/parent_id/is_other) 그대로 유지. 클라이언트의 renderHierarchicalBody가
-- type 분기로 multi/single 양쪽 지원.

BEGIN;

UPDATE survey_questions
   SET type = 'multi_select'
 WHERE id = 'q_v1d26_usage_hier' AND survey_id = 'survey_v1_dealer_2026rev';

DO $verify$
DECLARE
  _t TEXT;
BEGIN
  SELECT type INTO _t FROM survey_questions WHERE id = 'q_v1d26_usage_hier';
  IF _t != 'multi_select' THEN
    RAISE EXCEPTION '048 verification failed: q_v1d26_usage_hier type = % (expected multi_select)', _t;
  END IF;
END
$verify$;

COMMIT;
