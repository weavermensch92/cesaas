-- 042_dealer_v1_2026rev_seed.sql
-- Dealer 설문 v1 전면 개편 — survey_v1_dealer_2026rev 시드 + 26 questions.
--
-- 변경 요지:
--   1) 기존 survey_v1_dealer·survey_v2_dealer_ctt는 status 변경 없음 (active 유지).
--      Studio "기존 설문 선택"에 셋 다 표시. surveys-get은 updated_at desc로 최신(본 신규) 우선.
--      v1·v2 HTML이 명시 survey_id 파라미터로 fix하면 안정 (별 hotfix로 surveys-get에 survey_id 옵션 추가).
--   2) 26 survey_questions — 모든 id `q_v1d26_*` 컨벤션. 기존 v1·v2와 충돌 0.
--   3) 신규 type 추가 없음 — 003_voice.sql CHECK 제약 (single_select / multi_select / scale_1_10 /
--      nps / text_short / text_long / number / consent) 모두 재사용.
--   4) 옵션 JSONB 메타 확장:
--      - 계층 single_select(`q_v1d26_usage_hier`): {value, label_*, level: 0|1, parent_id, order, is_other}
--      - ranked multi_select(`q_v1d26_decision_roles`): 첫 옵션 메타에 {rank_max: 3}
--      - 조건부 기타 follow-up(`*_other` text_short): 메타 {dependsOn: {question_id, value:'other'}}
--   5) DW 6축은 type=scale_1_10 (1~5 → 1~10). 클라이언트가 unique 10 제약 강제 + 핸들러 측 검증.
--
-- 호출:
--   V_Voice/dealer/index.html이 `/surveys-get?audience=dealer&survey_id=survey_v1_dealer_2026rev`로 fetch.
--   자유 텍스트(text_short/text_long/기타) 답변은 responses-receive가 큐로 enqueue (043 인프라) → 번역.
--
-- 충돌 회피:
--   - 035 deploy_survey RPC는 직접 INSERT라 미사용.
--   - 037 R_10.05 v2 segment 분류는 work_env axis 가정 — 042 신규는 usage_hier만 있음.
--     responses-receive 핸들러가 usage_hier value → work_env mini-mapping (B-step에서).

BEGIN;

-- ============================================================================
-- 1. 신규 surveys row (v1·v2 그대로 active 유지)
-- ============================================================================
INSERT INTO surveys (
  id, title, description, target_audience,
  language_default, languages_available,
  estimated_minutes, status, created_by,
  version_label, brief_group_id
) VALUES (
  'survey_v1_dealer_2026rev',
  'HD건설기계 — Dealer 인터뷰 v1.2026rev (CTT Expo 개편)',
  '26문항 — DW 6축 1~10 unique 10 + 계층 usage(CTT Expo 4 대분류) + ranked 의사결정자 + 자유 텍스트 자동 번역. v1·v2와 병행 active.',
  'dealer',
  'ru',
  ARRAY['ru','en','ko'],
  6,
  'active',
  'manual',
  '1.2026',
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
-- 2. 26 survey_questions
-- ============================================================================

-- ----- 상담 메타 (text_short 3) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_target_company', 'survey_v1_dealer_2026rev', 'text_short',
    'Название компании клиента',
    'Customer company name',
    '상담 대상 회사명',
    NULL, NULL, true, 1),
  ('q_v1d26_contact_name', 'survey_v1_dealer_2026rev', 'text_short',
    'Контактное лицо',
    'Contact name',
    '담당자',
    NULL, NULL, false, 2),
  ('q_v1d26_contact_phone', 'survey_v1_dealer_2026rev', 'text_short',
    'Телефон',
    'Phone',
    '연락처',
    NULL, NULL, false, 3)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- DW 6축 — scale_1_10 + unique 10 (클라/서버 양측 강제) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_dw_price', 'survey_v1_dealer_2026rev', 'scale_1_10',
    'Цена / финансирование — важность (1—10)',
    'Price / financing — importance (1—10)',
    '가격·금융 조건 (1—10)',
    'price', NULL, true, 11),
  ('q_v1d26_dw_fuel', 'survey_v1_dealer_2026rev', 'scale_1_10',
    'Расход топлива и uptime — важность (1—10)',
    'Fuel efficiency & uptime — importance (1—10)',
    '연료 효율·가동 시간 (1—10)',
    'fuel', NULL, true, 12),
  ('q_v1d26_dw_durability', 'survey_v1_dealer_2026rev', 'scale_1_10',
    'Надёжность и срок службы — важность (1—10)',
    'Durability & reliability — importance (1—10)',
    '내구성·신뢰성 (1—10)',
    'durability', NULL, true, 13),
  ('q_v1d26_dw_service', 'survey_v1_dealer_2026rev', 'scale_1_10',
    'Сервис и запчасти — важность (1—10)',
    'Service & parts — importance (1—10)',
    '서비스·부품 (1—10)',
    'service', NULL, true, 14),
  ('q_v1d26_dw_reference', 'survey_v1_dealer_2026rev', 'scale_1_10',
    'Референсы и бренд — важность (1—10)',
    'References & brand — importance (1—10)',
    '레퍼런스·브랜드 (1—10)',
    'reference', NULL, true, 15),
  ('q_v1d26_dw_versatility', 'survey_v1_dealer_2026rev', 'scale_1_10',
    'Универсальность и опции — важность (1—10)',
    'Versatility & options — importance (1—10)',
    '다목적성·옵션 (1—10)',
    'versatility', NULL, true, 16)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 계층 usage (CTT Expo 4 대분류 — single_select) -----
-- options JSONB는 level 0 (대분류 4) + level 1 (세부 25 + 4 기타) = 33 entries.
-- 클라이언트는 level 0 클릭 → level 1 펼침 + level 0 자체는 선택 불가(트리거).
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_usage_hier', 'survey_v1_dealer_2026rev', 'single_select',
    'Какие отрасли посетите на CTT Expo 2026?',
    'Which CTT Expo 2026 product categories will you visit?',
    'CTT Expo 2026에서 방문할 제품 분야는?',
    NULL,
    '[
      {"value":"1","label_ru":"Строительная площадка","label_en":"Construction site (overall)","label_ko":"건설 현장 전반","level":0,"parent_id":null,"order":0},
        {"value":"1.1","label_ru":"Строительная техника","label_en":"Construction vehicles","label_ko":"건설 차량","level":1,"parent_id":"1","order":1},
        {"value":"1.2","label_ru":"Землеройная техника","label_en":"Earthmoving machinery","label_ko":"토공 기계","level":1,"parent_id":"1","order":2},
        {"value":"1.3","label_ru":"Дорожно-строительная техника","label_en":"Road construction machinery","label_ko":"도로 건설 기계","level":1,"parent_id":"1","order":3},
        {"value":"1.4","label_ru":"Подъёмное оборудование, краны и транспорт","label_en":"Lifting, cranes & material handling","label_ko":"양중 기기, 크레인 및 운반 장비","level":1,"parent_id":"1","order":4},
        {"value":"1.5","label_ru":"Строительное оборудование, инструменты и специальные системы","label_en":"Construction equipment, tools & special systems","label_ko":"건설 장비, 공구 및 특수 시스템","level":1,"parent_id":"1","order":5},
        {"value":"1.6","label_ru":"Оборудование для бетонных работ","label_en":"Concrete work equipment","label_ko":"콘크리트 공사 장비","level":1,"parent_id":"1","order":6},
        {"value":"1.7","label_ru":"Опалубка и леса","label_en":"Formwork & scaffolding","label_ko":"거푸집 및 비계","level":1,"parent_id":"1","order":7},
        {"value":"1.8","label_ru":"Объекты на стройплощадке","label_en":"Site facilities","label_ko":"현장 시설","level":1,"parent_id":"1","order":8},
        {"value":"1_other","label_ru":"Другое (укажите)","label_en":"Other (specify)","label_ko":"기타 (직접 입력)","level":1,"parent_id":"1","is_other":true,"order":9},
      {"value":"2","label_ru":"Добыча, переработка и транспортировка полезных ископаемых","label_en":"Mineral mining, processing & transport","label_ko":"광물 채굴, 가공 및 운반","level":0,"parent_id":null,"order":10},
        {"value":"2.1","label_ru":"Шахтная техника для добычи","label_en":"Mining machinery for excavation & operation","label_ko":"채굴 건설 및 채굴 작업용 광산 기계 및 시설","level":1,"parent_id":"2","order":11},
        {"value":"2.2","label_ru":"Техника для геологоразведки","label_en":"Geological exploration equipment","label_ko":"지질 탐사용 기계 및 장치","level":1,"parent_id":"2","order":12},
        {"value":"2.3","label_ru":"Переработка и обогащение полезных ископаемых","label_en":"Mineral processing & beneficiation","label_ko":"광물 가공 및 선광용 기계 및 장치","level":1,"parent_id":"2","order":13},
        {"value":"2.4","label_ru":"Транспортировка и хранение полезных ископаемых","label_en":"Mineral transport & storage","label_ko":"광물 운반 및 보관용 기계 및 장비","level":1,"parent_id":"2","order":14},
        {"value":"2.5","label_ru":"Запчасти и вспомогательные материалы","label_en":"Parts, spares & auxiliary materials","label_ko":"부품, 예비 부품 및 보조 재료","level":1,"parent_id":"2","order":15},
        {"value":"2.6","label_ru":"Цифровые технологии и инновации в горнодобыче","label_en":"Digital tech & innovation for mining","label_ko":"광업의 디지털 기술 및 혁신 솔루션","level":1,"parent_id":"2","order":16},
        {"value":"2.7","label_ru":"Исследования и разработки","label_en":"R&D","label_ko":"연구 및 개발","level":1,"parent_id":"2","order":17},
        {"value":"2.8","label_ru":"Безопасность в горнодобыче","label_en":"Mining safety","label_ko":"광업 산업 안전","level":1,"parent_id":"2","order":18},
        {"value":"2.9","label_ru":"Защита окружающей среды в горнодобыче","label_en":"Mining environmental protection","label_ko":"광업 환경 보호","level":1,"parent_id":"2","order":19},
        {"value":"2_other","label_ru":"Другое (укажите)","label_en":"Other (specify)","label_ko":"기타 (직접 입력)","level":1,"parent_id":"2","is_other":true,"order":20},
      {"value":"3","label_ru":"Производство строительных материалов","label_en":"Building materials production","label_ko":"건축 자재 생산","level":0,"parent_id":null,"order":21},
        {"value":"3.1","label_ru":"Цемент, известь, гипс","label_en":"Cement, lime, gypsum","label_ko":"시멘트, 석회, 석고 건축 자재 제조","level":1,"parent_id":"3","order":22},
        {"value":"3.2","label_ru":"Бетон, ЖБИ и сборные конструкции","label_en":"Concrete, RC products & prefabricated elements","label_ko":"콘크리트, 콘크리트 제품 및 프리패브 부재 생산 기계","level":1,"parent_id":"3","order":23},
        {"value":"3.3","label_ru":"Асфальтобетонные заводы","label_en":"Asphalt production plants","label_ko":"아스팔트 생산 기계 및 플랜트","level":1,"parent_id":"3","order":24},
        {"value":"3_other","label_ru":"Другое (укажите)","label_en":"Other (specify)","label_ko":"기타 (직접 입력)","level":1,"parent_id":"3","is_other":true,"order":25},
      {"value":"4","label_ru":"Запчасти, расходники, смазочные материалы и сервис","label_en":"Parts, consumables, lubricants & service","label_ko":"부품, 소모품, 윤활유 및 서비스 공급","level":0,"parent_id":null,"order":26},
        {"value":"4.1","label_ru":"Запчасти и комплектующие для техники","label_en":"Spare parts & components","label_ko":"기계용 예비 부품 및 구성품","level":1,"parent_id":"4","order":27},
        {"value":"4.2","label_ru":"Сервис","label_en":"Service","label_ko":"서비스","level":1,"parent_id":"4","order":28},
        {"value":"4.3","label_ru":"Испытания, измерения и контроль процессов","label_en":"Test, measurement & process control","label_ko":"시험, 측정 및 공정 제어 장치","level":1,"parent_id":"4","order":29},
        {"value":"4.4","label_ru":"Связь и навигация","label_en":"Communications & navigation","label_ko":"통신 및 항법","level":1,"parent_id":"4","order":30},
        {"value":"4.5","label_ru":"Безопасность труда","label_en":"Work safety","label_ko":"작업 안전","level":1,"parent_id":"4","order":31},
        {"value":"4_other","label_ru":"Другое (укажите)","label_en":"Other (specify)","label_ko":"기타 (직접 입력)","level":1,"parent_id":"4","is_other":true,"order":32}
    ]'::jsonb,
    true, 21)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 가동·수량·매출·보유 -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_avg_days', 'survey_v1_dealer_2026rev', 'single_select',
    'Сколько дней в неделю в среднем работает одна единица техники?',
    'Average days per week one unit of equipment operates?',
    '한 장비가 평균적으로 일하는 일수는? (주간 평균)',
    NULL,
    '[
      {"value":"0","label_ru":"0","label_en":"0","label_ko":"0"},
      {"value":"1","label_ru":"1","label_en":"1","label_ko":"1"},
      {"value":"2","label_ru":"2","label_en":"2","label_ko":"2"},
      {"value":"3","label_ru":"3","label_en":"3","label_ko":"3"},
      {"value":"4","label_ru":"4","label_en":"4","label_ko":"4"},
      {"value":"5","label_ru":"5","label_en":"5","label_ko":"5"},
      {"value":"6","label_ru":"6","label_en":"6","label_ko":"6"},
      {"value":"7","label_ru":"7","label_en":"7","label_ko":"7"}
    ]'::jsonb,
    true, 22),

  ('q_v1d26_unit_count', 'survey_v1_dealer_2026rev', 'number',
    'Сколько единиц техники сейчас эксплуатируется?',
    'How many units of equipment are currently in operation?',
    '총 가동되고 있는 장비 수 (대)',
    NULL, NULL, false, 23),

  ('q_v1d26_revenue_rub', 'survey_v1_dealer_2026rev', 'single_select',
    'Среднегодовая выручка (₽)',
    'Average annual revenue (RUB)',
    '연간 평균 매출액 (₽)',
    NULL,
    '[
      {"value":"lt_10m","label_ru":"< 10 млн ₽","label_en":"< 10M ₽","label_ko":"< 10M ₽"},
      {"value":"10_50m","label_ru":"10—50 млн ₽","label_en":"10—50M ₽","label_ko":"10—50M ₽"},
      {"value":"50_200m","label_ru":"50—200 млн ₽","label_en":"50—200M ₽","label_ko":"50—200M ₽"},
      {"value":"200_500m","label_ru":"200—500 млн ₽","label_en":"200—500M ₽","label_ko":"200—500M ₽"},
      {"value":"500m_1b","label_ru":"500 млн — 1 млрд ₽","label_en":"500M—1B ₽","label_ko":"500M—1B ₽"},
      {"value":"gt_1b","label_ru":"> 1 млрд ₽","label_en":"> 1B ₽","label_ko":"> 1B ₽"}
    ]'::jsonb,
    false, 24),

  ('q_v1d26_fleet5', 'survey_v1_dealer_2026rev', 'single_select',
    'Сколько единиц техники в парке?',
    'How many units in your fleet?',
    '보유 장비 수량',
    NULL,
    '[
      {"value":"0","label_ru":"0 ед.","label_en":"0 units","label_ko":"0대"},
      {"value":"1_10","label_ru":"1—10 ед.","label_en":"1—10 units","label_ko":"1—10대"},
      {"value":"10_50","label_ru":"10—50 ед.","label_en":"10—50 units","label_ko":"10—50대"},
      {"value":"50_100","label_ru":"50—100 ед.","label_en":"50—100 units","label_ko":"50—100대"},
      {"value":"gt_100","label_ru":"100+ ед.","label_en":"100+ units","label_ko":"100대+"}
    ]'::jsonb,
    false, 25)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 의사결정 참여자 (ranked multi_select max 3) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_decision_roles', 'survey_v1_dealer_2026rev', 'multi_select',
    'Кто участвует в принятии решения о закупке? Выберите топ-3 по приоритету',
    'Who participates in purchase decisions? Select top-3 in priority order',
    '의사결정 참여자 (클릭 순서대로 1·2·3 순위, 최대 3)',
    NULL,
    '[
      {"value":"owner","label_ru":"Собственник","label_en":"Owner","label_ko":"오너","rank_max":3},
      {"value":"procurement","label_ru":"Отдел закупок","label_en":"Procurement","label_ko":"구매팀"},
      {"value":"operator","label_ru":"Оператор","label_en":"Operator","label_ko":"오퍼레이터"},
      {"value":"site_manager","label_ru":"Прораб","label_en":"Site manager","label_ko":"현장소장"},
      {"value":"engineer","label_ru":"Инженер","label_en":"Engineer","label_ko":"엔지니어"},
      {"value":"hq","label_ru":"Согласование с HQ","label_en":"HQ approval","label_ko":"본사 승인"}
    ]'::jsonb,
    false, 26)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 구매 결정 요소 (10개 + 기타 follow-up) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_factors', 'survey_v1_dealer_2026rev', 'multi_select',
    'Важнейшие факторы при выборе техники',
    'Key factors when choosing equipment',
    '구매 결정 요소 (중요한 항목 모두)',
    NULL,
    '[
      {"value":"price","label_ru":"Цена","label_en":"Price","label_ko":"가격"},
      {"value":"financing","label_ru":"Условия финансирования","label_en":"Financing terms","label_ko":"금융 조건"},
      {"value":"reliability","label_ru":"Надёжность","label_en":"Reliability","label_ko":"신뢰성"},
      {"value":"service_network","label_ru":"Сервисная сеть","label_en":"Service network","label_ko":"서비스 네트워크"},
      {"value":"uptime_efficiency","label_ru":"Uptime / эффективность","label_en":"Uptime / efficiency","label_ko":"가동률·효율성"},
      {"value":"brand_reference","label_ru":"Референсы бренда","label_en":"Brand references","label_ko":"브랜드 레퍼런스"},
      {"value":"versatility","label_ru":"Универсальность","label_en":"Versatility","label_ko":"다목적성"},
      {"value":"fuel_efficiency","label_ru":"Топливная экономичность","label_en":"Fuel efficiency","label_ko":"연료 효율"},
      {"value":"resale_value","label_ru":"Остаточная стоимость","label_en":"Resale value","label_ko":"잔존 가치"},
      {"value":"training","label_ru":"Обучение операторов","label_en":"Operator training","label_ko":"운전자 교육"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"}
    ]'::jsonb,
    false, 27),

  ('q_v1d26_factors_other', 'survey_v1_dealer_2026rev', 'text_short',
    'Какие ещё факторы? (если выбрано «Другое»)',
    'Which other factors? (if «Other» selected)',
    '기타 항목 (위에서 「기타」 선택 시)',
    NULL,
    '[{"_meta":true,"dependsOn":{"question_id":"q_v1d26_factors","value":"other"}}]'::jsonb,
    false, 28)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 정보 수집 채널 (5개 + 기타 follow-up) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_channels', 'survey_v1_dealer_2026rev', 'multi_select',
    'Каналы получения информации о технике',
    'Information channels',
    '정보 수집 채널',
    NULL,
    '[
      {"value":"trade_show","label_ru":"Выставка","label_en":"Trade show","label_ko":"전시회"},
      {"value":"dealer_open_house","label_ru":"Открытый дом дилера","label_en":"Dealer open house","label_ko":"딜러 오픈 하우스"},
      {"value":"online","label_ru":"Онлайн","label_en":"Online","label_ko":"온라인"},
      {"value":"industry_peer","label_ru":"Рекомендация коллег","label_en":"Industry peer recommendation","label_ko":"동업 업계 추천"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"}
    ]'::jsonb,
    false, 29),

  ('q_v1d26_channels_other', 'survey_v1_dealer_2026rev', 'text_short',
    'Какой канал? (если выбрано «Другое»)',
    'Which channel? (if «Other» selected)',
    '기타 채널 (위에서 「기타」 선택 시)',
    NULL,
    '[{"_meta":true,"dependsOn":{"question_id":"q_v1d26_channels","value":"other"}}]'::jsonb,
    false, 30)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 장비 구매 시 고려 브랜드 (Yellow Table Top 10 + 중국 브랜드) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_competitor_brands', 'survey_v1_dealer_2026rev', 'multi_select',
    'Какие бренды рассматриваете при покупке техники?',
    'Which brands do you consider when buying equipment?',
    '장비 구매 시 고려하고 있는 브랜드',
    NULL,
    '[
      {"value":"caterpillar","label_ru":"Caterpillar","label_en":"Caterpillar","label_ko":"Caterpillar"},
      {"value":"komatsu","label_ru":"Komatsu","label_en":"Komatsu","label_ko":"Komatsu"},
      {"value":"volvo_ce","label_ru":"Volvo CE","label_en":"Volvo CE","label_ko":"Volvo CE"},
      {"value":"liebherr","label_ru":"Liebherr","label_en":"Liebherr","label_ko":"Liebherr"},
      {"value":"john_deere","label_ru":"John Deere","label_en":"John Deere","label_ko":"John Deere"},
      {"value":"hitachi","label_ru":"Hitachi","label_en":"Hitachi","label_ko":"Hitachi"},
      {"value":"jcb","label_ru":"JCB","label_en":"JCB","label_ko":"JCB"},
      {"value":"xcmg","label_ru":"XCMG","label_en":"XCMG","label_ko":"XCMG"},
      {"value":"sany","label_ru":"Sany","label_en":"Sany","label_ko":"Sany"},
      {"value":"sdlg","label_ru":"SDLG","label_en":"SDLG","label_ko":"SDLG"},
      {"value":"liugong","label_ru":"LiuGong","label_en":"LiuGong","label_ko":"LiuGong"},
      {"value":"zoomlion","label_ru":"Zoomlion","label_en":"Zoomlion","label_ko":"Zoomlion"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"}
    ]'::jsonb,
    false, 31)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 서비스 기대 (4 + 기타 follow-up) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_service_expect', 'survey_v1_dealer_2026rev', 'multi_select',
    'Какой сервис вы ожидаете?',
    'What service do you expect?',
    '어떤 서비스를 기대하고 있는지',
    NULL,
    '[
      {"value":"parts_stock","label_ru":"Наличие запчастей у дилера","label_en":"Dealer parts stock","label_ko":"딜러 부품 재고 보유량"},
      {"value":"service_speed","label_ru":"Скорость реакции сервиса","label_en":"Service response speed","label_ko":"서비스 대응 속도"},
      {"value":"training","label_ru":"Обучение по технике и ТО","label_en":"Equipment & maintenance training","label_ko":"장비·정비 교육"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"}
    ]'::jsonb,
    false, 32),

  ('q_v1d26_service_expect_other', 'survey_v1_dealer_2026rev', 'text_short',
    'Какой ещё сервис? (если выбрано «Другое»)',
    'What other service? (if «Other» selected)',
    '기타 서비스 (위에서 「기타」 선택 시)',
    NULL,
    '[{"_meta":true,"dependsOn":{"question_id":"q_v1d26_service_expect","value":"other"}}]'::jsonb,
    false, 33)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- DEVELON 구매 의사 (NPS-style 0~10 + 이유 text_long) -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_develon_score', 'survey_v1_dealer_2026rev', 'nps',
    'Готовность купить технику бренда DEVELON (0—10)',
    'Likelihood to purchase DEVELON brand equipment (0—10)',
    'DEVELON 브랜드 구매 의사 (0—10)',
    NULL, NULL, true, 34),

  ('q_v1d26_develon_reason', 'survey_v1_dealer_2026rev', 'text_long',
    'Почему такая оценка? (необязательно)',
    'Why this score? (optional)',
    '점수 주는 이유',
    NULL, NULL, false, 35)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ----- 동의 2 -----
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, required, sort_order)
VALUES
  ('q_v1d26_subscribe', 'survey_v1_dealer_2026rev', 'consent',
    'Согласны ли получать новостную рассылку HD Construction Equipment?',
    'Subscribe to HD Construction Equipment newsletter?',
    'HD건설기계 후속 소식 수신 동의',
    NULL, NULL, false, 40),

  ('q_v1d26_consent', 'survey_v1_dealer_2026rev', 'consent',
    'Согласие на обработку персональных данных',
    'Consent to personal data processing',
    '개인정보 처리 동의 *',
    NULL, NULL, true, 41)
ON CONFLICT (id) DO UPDATE
  SET title_ru = EXCLUDED.title_ru, title_en = EXCLUDED.title_en, title_ko = EXCLUDED.title_ko,
      axis = EXCLUDED.axis, options = EXCLUDED.options,
      required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 검증
-- ============================================================================
DO $verify$
DECLARE
  _survey_active INT;
  _q_count INT;
  _axis_filled INT;
  _v1_still_active INT;
  _v2_still_active INT;
BEGIN
  SELECT COUNT(*) INTO _survey_active
    FROM surveys WHERE id = 'survey_v1_dealer_2026rev' AND status = 'active';
  IF _survey_active != 1 THEN
    RAISE EXCEPTION '042 verification failed: survey_v1_dealer_2026rev active count = % (expected 1)', _survey_active;
  END IF;

  SELECT COUNT(*) INTO _q_count
    FROM survey_questions WHERE survey_id = 'survey_v1_dealer_2026rev';
  IF _q_count != 26 THEN
    RAISE EXCEPTION '042 verification failed: question count = % (expected 26)', _q_count;
  END IF;

  -- DW 6축이 모두 scale_1_10 + axis 채워졌는지
  SELECT COUNT(*) INTO _axis_filled
    FROM survey_questions
    WHERE survey_id = 'survey_v1_dealer_2026rev'
      AND type = 'scale_1_10'
      AND axis IN ('price','fuel','durability','service','reference','versatility');
  IF _axis_filled != 6 THEN
    RAISE EXCEPTION '042 verification failed: scale_1_10 axis questions = % (expected 6)', _axis_filled;
  END IF;

  -- 기존 v1·v2 archive 영향 없음
  SELECT COUNT(*) INTO _v1_still_active FROM surveys WHERE id = 'survey_v1_dealer' AND status = 'active';
  SELECT COUNT(*) INTO _v2_still_active FROM surveys WHERE id = 'survey_v2_dealer_ctt' AND status = 'active';
  IF _v1_still_active != 1 OR _v2_still_active != 1 THEN
    RAISE EXCEPTION '042 verification failed: v1=% v2=% (expected both 1)', _v1_still_active, _v2_still_active;
  END IF;
END
$verify$;

COMMIT;
