-- 045_dealer_v1_2026rev_6axis_title_restore.sql
-- 042에서 DW 6축 질문 title을 새로 작성했는데, 사용자 요청은 기존 032 title을 그대로 두고
-- type만 scale_1_5 → scale_1_10 변경(+ 클라이언트 unique 10 제약)이었음.
-- 본 마이그레이션은 신규 survey_v1_dealer_2026rev의 6축 title을 032 원본과 동일하게 복원.
--
-- 변경 없음: id·type(scale_1_10 유지)·axis·sort_order·required.
-- 변경: title_ru·title_en·title_ko 만.

BEGIN;

UPDATE survey_questions SET
  title_ru = 'Цена / финансирование — насколько важно',
  title_en = 'Price / financing — importance',
  title_ko = '가격·금융 조건의 중요도'
WHERE id = 'q_v1d26_dw_price' AND survey_id = 'survey_v1_dealer_2026rev';

UPDATE survey_questions SET
  title_ru = 'Расход топлива и время работы — насколько важно',
  title_en = 'Fuel efficiency & uptime — importance',
  title_ko = '연료 효율·가동 시간의 중요도'
WHERE id = 'q_v1d26_dw_fuel' AND survey_id = 'survey_v1_dealer_2026rev';

UPDATE survey_questions SET
  title_ru = 'Надёжность и срок службы — насколько важно',
  title_en = 'Durability & reliability — importance',
  title_ko = '내구성·신뢰성의 중요도'
WHERE id = 'q_v1d26_dw_durability' AND survey_id = 'survey_v1_dealer_2026rev';

UPDATE survey_questions SET
  title_ru = 'Сервисная сеть и поставка запчастей — насколько важно',
  title_en = 'Service network & parts — importance',
  title_ko = '서비스 네트워크·부품 조달의 중요도'
WHERE id = 'q_v1d26_dw_service' AND survey_id = 'survey_v1_dealer_2026rev';

UPDATE survey_questions SET
  title_ru = 'Референсы и узнаваемость бренда — насколько важно',
  title_en = 'Project references & brand — importance',
  title_ko = '프로젝트 레퍼런스·인지도의 중요도'
WHERE id = 'q_v1d26_dw_reference' AND survey_id = 'survey_v1_dealer_2026rev';

UPDATE survey_questions SET
  title_ru = 'Многозадачность и опции — насколько важно',
  title_en = 'Multi-purpose versatility — importance',
  title_ko = '다목적 활용성·옵션의 중요도'
WHERE id = 'q_v1d26_dw_versatility' AND survey_id = 'survey_v1_dealer_2026rev';

-- 검증 — 6개 모두 UPDATE 됐는지
DO $verify$
DECLARE
  _matched INT;
BEGIN
  SELECT COUNT(*) INTO _matched FROM survey_questions
   WHERE survey_id = 'survey_v1_dealer_2026rev'
     AND id LIKE 'q_v1d26_dw_%'
     AND title_ko LIKE '%중요도';
  IF _matched != 6 THEN
    RAISE EXCEPTION '045 verification failed: DW axis questions with "중요도" suffix = % (expected 6)', _matched;
  END IF;
END
$verify$;

COMMIT;
