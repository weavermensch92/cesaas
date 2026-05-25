-- 039_dealer_v2_ctt_survey_seed.sql
-- CTT Moscow 2026 부스용 dealer 설문 v2 시드 — 18문항 (Block A 5 / B 6 / C 4 / D 3).
--
-- 변경 요지 (v2 — 2026-05-25 정정):
--   1) 기존 survey_v1_dealer는 **그대로 active 유지** — 위버 결정 (5/26 부스에서 두 버전 병행 가능).
--      이전 초안의 `UPDATE surveys SET status='archived' WHERE id='survey_v1_dealer'` 절 제거.
--      Studio에서 dealer audience에 v1·v2 둘 다 active 표시. surveys-get은 updated_at desc로 v2 우선 fetch.
--   2) 신규 surveys row 'survey_v2_dealer_ctt' INSERT — version_label='2.0', brief_group_id 새 UUID,
--      estimated_minutes=8, target_audience='dealer', status='active'.
--   3) 18 survey_questions INSERT.
--      id 컨벤션: q_v2dctt_<block><n>_<short_name>
--      type: 003_voice.sql CHECK 제약(single_select|multi_select|scale_1_5|scale_1_10|nps|text_short|text_long|number|slider|consent) 모두 재사용.
--      B-Q1 (axis_ranks) = multi_select 재사용 + 옵션 메타 + UI가 클릭 순서대로 1·2·3 순위 부여.
--      axis 컬럼 — segment용 question은 NULL, axis self-report용 question은 해당 axis 값.
--   4) 옵션 JSONB는 표준 [{value, label_ru, label_en, label_ko}] + 매핑 힌트 메타(axis_signals, work_env, rank_max 등).
--
-- 호출:
--   V_Voice/backend/functions/surveys-get + dealer/v2 index.html 이 자동으로 18문항 렌더.
--   responses-receive 핸들러는 axis_data 합성을 Phase B(heatmap_mapping.ts)에서 갱신.
--
-- 충돌 회피:
--   035_studio_v2.sql의 deploy_survey v2 RPC와는 무관 (본 마이그레이션은 직접 INSERT).
--   향후 Studio 사후 편집 시: parent_survey_id=survey_v2_dealer_ctt 로 draft 생성 → deploy_survey가
--   새 ID(survey_v1_dealer_<slug>_<ts>) 발행 + 이전 archive. 본 시드 ID와 충돌 0.

BEGIN;

-- ============================================================================
-- 1. 신규 v2 survey row (v1은 그대로 active 유지)
-- ============================================================================
INSERT INTO surveys (
  id, title, description, target_audience,
  language_default, languages_available,
  estimated_minutes, status, created_by,
  version_label, brief_group_id
) VALUES (
  'survey_v2_dealer_ctt',
  'CTT Moscow 2026 — Dealer Interview (8 segment × 6 axis heatmap)',
  '18문항 (Block A 5 / B 6 / C 4 / D 3). A-Q2 작업환경이 segment 1차 결정, B-Q1 axis 1·2·3순위가 self-report self_report_boost, B-Q2 pain이 pain_boost, B-Q6 service_sat이 gap_boost.',
  'dealer',
  'ru',
  ARRAY['ru','en','ko'],
  8,
  'active',
  'manual',
  '2.0',
  gen_random_uuid()
)
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      estimated_minutes = EXCLUDED.estimated_minutes,
      version_label = EXCLUDED.version_label,
      updated_at = now();

-- ============================================================================
-- 3. 18 survey_questions
-- ============================================================================
-- 충돌 방지: 본 마이그레이션을 두 번 적용해도 안전하도록 ON CONFLICT(id) DO UPDATE.
-- sort_order 1~100 (A: 1~5, B: 11~16, C: 21~24, D: 31~33).

-- ----------------------------- Block A — Segment 확정 (5) -----------------------------
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v2dctt_a1_fleet', 'survey_v2_dealer_ctt', 'single_select',
    'Размер парка (количество единиц)',
    'Fleet size (units owned/managed)',
    '운영 fleet 규모 (대수)',
    NULL,
    '[
      {"value":"S","label_ru":"1—4","label_en":"1—4","label_ko":"1—4"},
      {"value":"M","label_ru":"5—19","label_en":"5—19","label_ko":"5—19"},
      {"value":"L","label_ru":"20—49","label_en":"20—49","label_ko":"20—49"},
      {"value":"XL","label_ru":"50+","label_en":"50+","label_ko":"50+"}
    ]'::jsonb,
    true, 1),

  ('q_v2dctt_a2_work_env', 'survey_v2_dealer_ctt', 'single_select',
    'Основная среда эксплуатации',
    'Primary work environment',
    '주된 작업 환경',
    NULL,
    '[
      {"value":"individual_owner","label_ru":"Индивидуальный предприниматель / самозанятый","label_en":"Individual / owner-operator","label_ko":"개인 사업자 / 자영업"},
      {"value":"fleet_rental","label_ru":"Парк / арендный бизнес","label_en":"Fleet / rental business","label_ko":"플릿 / 렌탈 사업"},
      {"value":"large_corporate","label_ru":"Крупная корпорация (50+ ед.)","label_en":"Large corporation (50+ units)","label_ko":"대기업·법인 (50대+)"},
      {"value":"mining","label_ru":"Горнодобыча","label_en":"Mining","label_ko":"광업"},
      {"value":"infrastructure","label_ru":"Инфраструктура / крупное строительство","label_en":"Infrastructure / heavy construction","label_ko":"인프라 / 대형 건설"},
      {"value":"agri_plantation","label_ru":"С/х / плантация","label_en":"Agriculture / plantation","label_ko":"농업 / 플랜테이션"},
      {"value":"quarry","label_ru":"Карьер","label_en":"Quarry","label_ko":"채석장"},
      {"value":"gov_public","label_ru":"Гос. сектор / общественные работы","label_en":"Government / public works","label_ko":"정부 / 공공 사업"}
    ]'::jsonb,
    true, 2),

  ('q_v2dctt_a3_annual_days', 'survey_v2_dealer_ctt', 'single_select',
    'Дней эксплуатации в год',
    'Operating days per year',
    '연간 가동일 수',
    NULL,
    '[
      {"value":"lt_100","label_ru":"<100","label_en":"<100","label_ko":"<100"},
      {"value":"100_200","label_ru":"100—200","label_en":"100—200","label_ko":"100—200"},
      {"value":"200_300","label_ru":"200—300","label_en":"200—300","label_ko":"200—300"},
      {"value":"gte_300","label_ru":"300+","label_en":"300+","label_ko":"300+"}
    ]'::jsonb,
    true, 3),

  ('q_v2dctt_a4_decision_role', 'survey_v2_dealer_ctt', 'single_select',
    'Как принимаются решения о закупке',
    'How purchase decisions are made',
    '구매 의사결정 방식',
    NULL,
    '[
      {"value":"individual","label_ru":"Единолично","label_en":"Individual","label_ko":"단독"},
      {"value":"committee","label_ru":"Через комитет","label_en":"Committee","label_ko":"위원회"},
      {"value":"executive","label_ru":"Руководитель / совет директоров","label_en":"Executive / board","label_ko":"임원·이사회"},
      {"value":"hq_approval","label_ru":"Согласование с HQ","label_en":"HQ approval","label_ko":"본사 승인"}
    ]'::jsonb,
    true, 4),

  ('q_v2dctt_a5_annual_budget', 'survey_v2_dealer_ctt', 'single_select',
    'Годовой бюджет на технику',
    'Annual equipment budget',
    '연간 장비 지출 규모',
    NULL,
    '[
      {"value":"XS","label_ru":"< 5 млн ₽","label_en":"< 5M ₽","label_ko":"< 5M ₽"},
      {"value":"S","label_ru":"5—20 млн ₽","label_en":"5—20M ₽","label_ko":"5—20M ₽"},
      {"value":"M","label_ru":"20—50 млн ₽","label_en":"20—50M ₽","label_ko":"20—50M ₽"},
      {"value":"L","label_ru":"50—200 млн ₽","label_en":"50—200M ₽","label_ko":"50—200M ₽"},
      {"value":"XL","label_ru":"> 200 млн ₽","label_en":"> 200M ₽","label_ko":"> 200M ₽"}
    ]'::jsonb,
    true, 5)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru,
      title_en = EXCLUDED.title_en,
      title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis,
      options = EXCLUDED.options,
      required = EXCLUDED.required,
      sort_order = EXCLUDED.sort_order;

-- ----------------------------- Block B — Axis 가중치 (6) -----------------------------
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v2dctt_b1_axis_ranks', 'survey_v2_dealer_ctt', 'multi_select',
    'Расставьте 3 самых важных критерия при выборе техники (1·2·3)',
    'Pick top-3 buying criteria in order (1·2·3)',
    '장비 선택 시 가장 중요한 3가지 (1·2·3 순위)',
    NULL,
    '[
      {"value":"price","label_ru":"Цена / финансирование","label_en":"Price / financing","label_ko":"가격·금융 조건"},
      {"value":"fuel","label_ru":"Расход топлива / время работы","label_en":"Fuel efficiency / uptime","label_ko":"연료·가동시간"},
      {"value":"durability","label_ru":"Надёжность / срок службы","label_en":"Durability / reliability","label_ko":"내구성·신뢰성"},
      {"value":"service","label_ru":"Сервис / запчасти","label_en":"Service / parts","label_ko":"서비스·부품"},
      {"value":"reference","label_ru":"Референсы / бренд","label_en":"References / brand","label_ko":"레퍼런스·브랜드"},
      {"value":"versatility","label_ru":"Многозадачность / опции","label_en":"Versatility / attachments","label_ko":"다목적성·옵션"}
    ]'::jsonb,
    true, 11),

  ('q_v2dctt_b2_pains', 'survey_v2_dealer_ctt', 'multi_select',
    'Какие проблемы вы испытываете с текущей техникой',
    'Pain points with current equipment',
    '현 보유 장비의 불만 사항',
    NULL,
    '[
      {"value":"high_fuel_cost","label_ru":"Высокий расход топлива","label_en":"High fuel cost","label_ko":"높은 연료비","axis_signals":["fuel"]},
      {"value":"frequent_breakdown","label_ru":"Частые поломки","label_en":"Frequent breakdowns","label_ko":"잦은 고장","axis_signals":["durability"]},
      {"value":"slow_service","label_ru":"Медленный сервис","label_en":"Slow service","label_ko":"느린 서비스","axis_signals":["service"]},
      {"value":"parts_shortage","label_ru":"Дефицит запчастей","label_en":"Parts shortage","label_ko":"부품 부족","axis_signals":["service"]},
      {"value":"high_purchase_cost","label_ru":"Высокая цена покупки","label_en":"High purchase cost","label_ko":"높은 구매가","axis_signals":["price"]},
      {"value":"low_resale","label_ru":"Низкая остаточная стоимость","label_en":"Low resale value","label_ko":"낮은 잔존가","axis_signals":["reference","price"]},
      {"value":"limited_attachments","label_ru":"Мало навесного","label_en":"Limited attachments","label_ko":"제한적 어태치먼트","axis_signals":["versatility"]},
      {"value":"brand_trust","label_ru":"Недоверие к бренду","label_en":"Brand trust issues","label_ko":"브랜드 신뢰 부족","axis_signals":["reference"]},
      {"value":"financing_terms","label_ru":"Жёсткие условия лизинга","label_en":"Tough financing terms","label_ko":"빡빡한 리스 조건","axis_signals":["price"]},
      {"value":"operator_training","label_ru":"Сложность обучения операторов","label_en":"Operator training","label_ko":"운전자 교육 부담","axis_signals":["service"]},
      {"value":"undercarriage_wear","label_ru":"Износ ходовой","label_en":"Undercarriage wear","label_ko":"하부 마모","axis_signals":["durability"]},
      {"value":"none","label_ru":"Нет проблем","label_en":"No issues","label_ko":"불만 없음","axis_signals":[]}
    ]'::jsonb,
    false, 12),

  ('q_v2dctt_b3_daily_hours', 'survey_v2_dealer_ctt', 'single_select',
    'Часов работы в день (типично)',
    'Daily operating hours (typical)',
    '1일 가동 시간 (대표값)',
    'fuel',
    '[
      {"value":"lt_4","label_ru":"< 4 ч","label_en":"< 4 h","label_ko":"< 4시간"},
      {"value":"4_8","label_ru":"4—8 ч","label_en":"4—8 h","label_ko":"4—8시간"},
      {"value":"8_12","label_ru":"8—12 ч","label_en":"8—12 h","label_ko":"8—12시간"},
      {"value":"gte_12","label_ru":"12+ ч","label_en":"12+ h","label_ko":"12시간+"}
    ]'::jsonb,
    true, 13),

  ('q_v2dctt_b4_brands', 'survey_v2_dealer_ctt', 'multi_select',
    'Какими брендами вы пользуетесь сейчас',
    'Current brands in use',
    '현재 사용 중인 브랜드',
    'reference',
    '[
      {"value":"HD","label_ru":"HD","label_en":"HD","label_ko":"HD"},
      {"value":"Komatsu","label_ru":"Komatsu","label_en":"Komatsu","label_ko":"Komatsu"},
      {"value":"Caterpillar","label_ru":"Caterpillar","label_en":"Caterpillar","label_ko":"Caterpillar"},
      {"value":"Volvo","label_ru":"Volvo","label_en":"Volvo","label_ko":"Volvo"},
      {"value":"SDLG","label_ru":"SDLG","label_en":"SDLG","label_ko":"SDLG"},
      {"value":"XCMG","label_ru":"XCMG","label_en":"XCMG","label_ko":"XCMG"},
      {"value":"Sany","label_ru":"Sany","label_en":"Sany","label_ko":"Sany"},
      {"value":"JCB","label_ru":"JCB","label_en":"JCB","label_ko":"JCB"},
      {"value":"Liebherr","label_ru":"Liebherr","label_en":"Liebherr","label_ko":"Liebherr"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"}
    ]'::jsonb,
    false, 14),

  ('q_v2dctt_b5_severity', 'survey_v2_dealer_ctt', 'scale_1_5',
    'Насколько тяжёлые условия эксплуатации (1—5)',
    'Operating severity (1—5)',
    '작업 환경 가혹도 (1—5)',
    'durability',
    NULL,
    true, 15),

  ('q_v2dctt_b6_service_sat', 'survey_v2_dealer_ctt', 'scale_1_5',
    'Удовлетворённость сервисом текущего поставщика (1—5)',
    'Satisfaction with current service (1—5)',
    '현 공급사 서비스 만족도 (1—5)',
    'service',
    NULL,
    true, 16)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru,
      title_en = EXCLUDED.title_en,
      title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis,
      options = EXCLUDED.options,
      required = EXCLUDED.required,
      sort_order = EXCLUDED.sort_order;

-- ----------------------------- Block C — 구매 의향 (4) -----------------------------
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v2dctt_c1_plan_12m', 'survey_v2_dealer_ctt', 'single_select',
    'Планы по закупке в ближайшие 12 месяцев',
    'Purchase plans in next 12 months',
    '12개월 내 구매 계획',
    NULL,
    '[
      {"value":"none","label_ru":"Нет","label_en":"None","label_ko":"없음"},
      {"value":"considering","label_ru":"Рассматриваем","label_en":"Considering","label_ko":"검토 중"},
      {"value":"within_12m","label_ru":"В течение 12 мес","label_en":"Within 12 months","label_ko":"12개월 내"},
      {"value":"within_6m","label_ru":"В течение 6 мес","label_en":"Within 6 months","label_ko":"6개월 내"},
      {"value":"within_3m","label_ru":"В течение 3 мес","label_en":"Within 3 months","label_ko":"3개월 내"}
    ]'::jsonb,
    true, 21),

  ('q_v2dctt_c2_equip_types', 'survey_v2_dealer_ctt', 'multi_select',
    'Какую технику рассматриваете',
    'Which equipment types are you considering',
    '검토 중인 장비 종류',
    NULL,
    '[
      {"value":"excavator","label_ru":"Экскаватор","label_en":"Excavator","label_ko":"굴착기"},
      {"value":"wheel_loader","label_ru":"Колёсный погрузчик","label_en":"Wheel loader","label_ko":"휠로더"},
      {"value":"dozer","label_ru":"Бульдозер","label_en":"Dozer","label_ko":"불도저"},
      {"value":"motor_grader","label_ru":"Автогрейдер","label_en":"Motor grader","label_ko":"모터그레이더"},
      {"value":"compactor","label_ru":"Каток","label_en":"Compactor","label_ko":"롤러"},
      {"value":"forklift","label_ru":"Погрузчик","label_en":"Forklift","label_ko":"지게차"},
      {"value":"attachment_only","label_ru":"Только навесное","label_en":"Attachments only","label_ko":"어태치먼트만"}
    ]'::jsonb,
    false, 22),

  ('q_v2dctt_c3_purchase_mode', 'survey_v2_dealer_ctt', 'single_select',
    'Предпочтительный способ покупки',
    'Preferred purchase mode',
    '선호 구매 방식',
    'price',
    '[
      {"value":"cash","label_ru":"Денежная покупка","label_en":"Cash","label_ko":"일시불"},
      {"value":"lease","label_ru":"Лизинг","label_en":"Lease","label_ko":"리스"},
      {"value":"financing","label_ru":"Кредит / рассрочка","label_en":"Financing","label_ko":"할부·금융"},
      {"value":"rental_first","label_ru":"Сначала аренда","label_en":"Rental first","label_ko":"렌탈 우선"}
    ]'::jsonb,
    true, 23),

  ('q_v2dctt_c4_booth_interest', 'survey_v2_dealer_ctt', 'multi_select',
    'Что интересует на стенде',
    'Booth interests',
    '부스에서 관심 있는 것',
    NULL,
    '[
      {"value":"tco","label_ru":"Расчёт TCO","label_en":"TCO comparison","label_ko":"TCO 비교"},
      {"value":"demo","label_ru":"Демо / тест-драйв","label_en":"Demo / test drive","label_ko":"데모·시승"},
      {"value":"parts","label_ru":"Запчасти / сервис","label_en":"Parts / service","label_ko":"부품·서비스"},
      {"value":"training","label_ru":"Обучение операторов","label_en":"Operator training","label_ko":"운전자 교육"},
      {"value":"financing","label_ru":"Финансирование","label_en":"Financing options","label_ko":"파이낸싱"},
      {"value":"used_market","label_ru":"Б/у техника","label_en":"Used market","label_ko":"중고 시장"}
    ]'::jsonb,
    false, 24)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru,
      title_en = EXCLUDED.title_en,
      title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis,
      options = EXCLUDED.options,
      required = EXCLUDED.required,
      sort_order = EXCLUDED.sort_order;

-- ----------------------------- Block D — 신원·후속 (3) -----------------------------
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v2dctt_d1_decision_role', 'survey_v2_dealer_ctt', 'single_select',
    'Ваша роль в решении о закупке',
    'Your role in purchase decision',
    '구매 의사결정에서의 역할',
    NULL,
    '[
      {"value":"self","label_ru":"Принимаю сам","label_en":"Decide myself","label_ko":"본인 결정"},
      {"value":"team","label_ru":"Решение командой","label_en":"Team decides","label_ko":"팀 결정"},
      {"value":"manager","label_ru":"Решает руководитель","label_en":"Manager decides","label_ko":"관리자 결정"},
      {"value":"executive","label_ru":"Решает топ-менеджмент","label_en":"Executive decides","label_ko":"임원진 결정"}
    ]'::jsonb,
    false, 31),

  ('q_v2dctt_d2_followup_opt_in', 'survey_v2_dealer_ctt', 'consent',
    'Согласны ли получать предложения от HD',
    'Opt in to HD follow-up contact',
    'HD 후속 영업 제안 수신 동의',
    NULL,
    NULL,
    false, 32),

  ('q_v2dctt_d3_channel', 'survey_v2_dealer_ctt', 'single_select',
    'Предпочтительный канал связи',
    'Preferred contact channel',
    '선호 연락 채널',
    NULL,
    '[
      {"value":"whatsapp","label_ru":"WhatsApp","label_en":"WhatsApp","label_ko":"WhatsApp"},
      {"value":"telegram","label_ru":"Telegram","label_en":"Telegram","label_ko":"Telegram"},
      {"value":"email","label_ru":"Email","label_en":"Email","label_ko":"이메일"},
      {"value":"phone","label_ru":"Телефон","label_en":"Phone","label_ko":"전화"},
      {"value":"none","label_ru":"Не нужно","label_en":"No contact","label_ko":"연락 불필요"}
    ]'::jsonb,
    false, 33)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru,
      title_en = EXCLUDED.title_en,
      title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis,
      options = EXCLUDED.options,
      required = EXCLUDED.required,
      sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 검증
-- ============================================================================
DO $verify$
DECLARE
  _v2_active INT;
  _q_count   INT;
  _axis_filled INT;
BEGIN
  -- v1은 의도적으로 active 유지 — archive 체크 생략.

  SELECT COUNT(*) INTO _v2_active
    FROM surveys WHERE id = 'survey_v2_dealer_ctt' AND status = 'active';
  IF _v2_active != 1 THEN
    RAISE EXCEPTION '039 verification failed: survey_v2_dealer_ctt active count = % (expected 1)', _v2_active;
  END IF;

  SELECT COUNT(*) INTO _q_count
    FROM survey_questions WHERE survey_id = 'survey_v2_dealer_ctt';
  IF _q_count != 18 THEN
    RAISE EXCEPTION '039 verification failed: question count = % (expected 18)', _q_count;
  END IF;

  -- axis 컬럼이 채워진 question은 fuel/reference/durability/service/price 5개 (B3·B4·B5·B6·C3).
  SELECT COUNT(*) INTO _axis_filled
    FROM survey_questions
    WHERE survey_id = 'survey_v2_dealer_ctt'
      AND axis IN ('price','fuel','durability','service','reference','versatility');
  IF _axis_filled != 5 THEN
    RAISE EXCEPTION '039 verification failed: axis-tagged questions = % (expected 5)', _axis_filled;
  END IF;
END
$verify$;

COMMIT;
