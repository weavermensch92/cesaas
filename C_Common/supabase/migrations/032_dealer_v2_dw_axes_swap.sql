-- 032_dealer_v2_dw_axes_swap.sql
-- Dealer v2 포지셔닝 맵 Radar를 CA(분류 6축)에서 DW(결정가중치 6축)로 교체.
--
-- 변경 의도:
--   v2 dealer/index.html의 #profileGrid (회사 프로필 2×3) + #radarWrap (Positioning Map)은
--   `survey_questions.axis` 컬럼이 NULL이 아닌 질문 6개를 동일 소스로 사용.
--   기존 시드(003_voice.sql)는 CA 6축(scale·usage·hours·deal_rub·fleet·role) 채움 → 라더에
--   "scale/usage/..." 라벨이 표시됨. 본 마이그레이션은 그 6 자리를 DW 6축으로 교체.
--
-- 변경 사항:
--   1) 기존 CA 6 질문의 axis 컬럼을 NULL로 (질문은 유지·답변 수집은 그대로, 라더에서만 제외)
--      → CA 답변은 segment 분류용으로 axis_data에 들어갈 수 있음 (현재 dealer v2는 axis_data=null 송출)
--   2) DW 6 질문 신설 — type=scale_1_5, axis=price·fuel·durability·service·reference·versatility
--      → profile-grid에 2×3로 배치 + Radar 라벨에 노출
--   3) sort_order는 100~105 (기존 시드와 충돌 회피)
--
-- 비고:
--   - 본 마이그레이션은 직접 1~5 평가. 향후 R_10.10 간접 추론(PR #5)으로 확장 시
--     responses.preference_axes 컬럼에 산출 결과가 직접 들어감 — UI는 동일.
--   - Visitor PWA(survey_v1_visitor)는 후속 마이그레이션에서 동일 패턴 적용.

BEGIN;

-- ============================================================================
-- 1. 기존 CA 6 질문 — axis 컬럼 NULL로
-- ============================================================================
UPDATE survey_questions
   SET axis = NULL,
       updated_at = now()
 WHERE survey_id = 'survey_v1_dealer'
   AND id IN (
     'q_v1d_scale',
     'q_v1d_usage',
     'q_v1d_hours',
     'q_v1d_deal_rub',
     'q_v1d_fleet',
     'q_v1d_role'
   );

-- ============================================================================
-- 2. DW 6 질문 신설 — Positioning Map용 직접 1~5 Likert
-- ============================================================================
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, sort_order, required)
VALUES
  ('q_v1d_dw_price', 'survey_v1_dealer', 'scale_1_5',
    'Цена / финансирование — насколько важно',
    'Price / financing — importance',
    '가격·금융 조건의 중요도',
    'price', NULL, 100, false),

  ('q_v1d_dw_fuel', 'survey_v1_dealer', 'scale_1_5',
    'Расход топлива и время работы — насколько важно',
    'Fuel efficiency & uptime — importance',
    '연료 효율·가동 시간의 중요도',
    'fuel', NULL, 101, false),

  ('q_v1d_dw_durability', 'survey_v1_dealer', 'scale_1_5',
    'Надёжность и срок службы — насколько важно',
    'Durability & reliability — importance',
    '내구성·신뢰성의 중요도',
    'durability', NULL, 102, false),

  ('q_v1d_dw_service', 'survey_v1_dealer', 'scale_1_5',
    'Сервисная сеть и поставка запчастей — насколько важно',
    'Service network & parts — importance',
    '서비스 네트워크·부품 조달의 중요도',
    'service', NULL, 103, false),

  ('q_v1d_dw_reference', 'survey_v1_dealer', 'scale_1_5',
    'Референсы и узнаваемость бренда — насколько важно',
    'Project references & brand — importance',
    '프로젝트 레퍼런스·인지도의 중요도',
    'reference', NULL, 104, false),

  ('q_v1d_dw_versatility', 'survey_v1_dealer', 'scale_1_5',
    'Многозадачность и опции — насколько важно',
    'Multi-purpose versatility — importance',
    '다목적 활용성·옵션의 중요도',
    'versatility', NULL, 105, false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 검증
-- ============================================================================
DO $verify$
DECLARE
  _ca_with_axis INT;
  _dw_with_axis INT;
BEGIN
  SELECT COUNT(*) INTO _ca_with_axis
    FROM survey_questions
    WHERE survey_id = 'survey_v1_dealer'
      AND id IN ('q_v1d_scale','q_v1d_usage','q_v1d_hours','q_v1d_deal_rub','q_v1d_fleet','q_v1d_role')
      AND axis IS NOT NULL;
  IF _ca_with_axis != 0 THEN
    RAISE EXCEPTION '032 verification failed: % CA questions still have axis (expected 0)', _ca_with_axis;
  END IF;

  SELECT COUNT(*) INTO _dw_with_axis
    FROM survey_questions
    WHERE survey_id = 'survey_v1_dealer'
      AND axis IN ('price','fuel','durability','service','reference','versatility')
      AND id LIKE 'q_v1d_dw_%';
  IF _dw_with_axis != 6 THEN
    RAISE EXCEPTION '032 verification failed: % DW questions exist (expected 6)', _dw_with_axis;
  END IF;
END
$verify$;

COMMIT;
