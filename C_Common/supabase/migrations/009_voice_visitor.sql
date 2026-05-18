-- ============================================================================
-- 009_voice_visitor.sql
-- Visitor 18문항 시드 + 옵트인 연락처 저장 컬럼.
-- V_20.02 (문항 구조) · V_20.03 (필수) · V_20.04 (선택).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- responses 확장 — 옵트인 연락처 (PII).
-- 30일 자동 익명화 트리거는 운영 cron으로 별도 등록.
-- ----------------------------------------------------------------------------
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS notes         TEXT,
  ADD COLUMN IF NOT EXISTS contact_opted_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pii_redacted_at TIMESTAMPTZ;

COMMENT ON COLUMN responses.contact_opted_in IS
  'Visitor가 옵트인 클릭한 경우만 true. opt-in 후에도 30일 후 자동 익명화 (C_07_보안_법무).';

CREATE INDEX IF NOT EXISTS idx_responses_opted_in
  ON responses (contact_opted_in)
  WHERE contact_opted_in = true AND pii_redacted_at IS NULL;

-- ----------------------------------------------------------------------------
-- save_response 확장 — 옵트인 연락처/메모 인자 추가.
-- 기존 시그니처 호환 위해 OR REPLACE.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS save_response(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, BOOLEAN,
  TEXT, TEXT, REAL, JSONB, JSONB, TIMESTAMPTZ
);

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
  p_contact_name        TEXT  DEFAULT NULL,
  p_contact_phone       TEXT  DEFAULT NULL,
  p_contact_email       TEXT  DEFAULT NULL,
  p_notes               TEXT  DEFAULT NULL,
  p_contact_opted_in    BOOLEAN DEFAULT FALSE
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
    contact_name, contact_phone, contact_email, notes, contact_opted_in
  ) VALUES (
    p_survey_id, p_respondent_type, p_dealer_id, p_device_id, p_event, COALESCE(p_language, 'ru'),
    p_nps, p_future_subscription, p_consent,
    p_segment, p_segment_method, p_segment_conf, p_axis_data,
    p_captured_at, p_respondent_type::source_t,
    NULLIF(p_contact_name, ''),
    NULLIF(p_contact_phone, ''),
    NULLIF(p_contact_email, ''),
    NULLIF(p_notes, ''),
    COALESCE(p_contact_opted_in, false)
  )
  RETURNING id INTO _resp_id;

  IF p_answers IS NOT NULL THEN
    FOR _ans IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
      INSERT INTO response_answers (response_id, question_id, answer)
      VALUES (_resp_id, _ans ->> 'question_id', _ans -> 'answer')
      ON CONFLICT (response_id, question_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN _resp_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- visitor_rate_limit — device_id 별 1일 N건 제한 (Bot 방지·중복 응답).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION visitor_quota_remaining(p_device_id TEXT, p_per_day INT DEFAULT 5)
RETURNS INT
LANGUAGE sql STABLE
AS $$
  SELECT GREATEST(
    0,
    p_per_day - COALESCE((
      SELECT count(*)
        FROM responses
       WHERE device_id = p_device_id
         AND respondent_type = 'visitor'
         AND created_at > now() - interval '24 hours'
    ), 0)
  );
$$;

COMMENT ON FUNCTION visitor_quota_remaining IS
  '같은 device_id 24h 내 응답 수 잔여. Edge Function이 0이면 reject.';

-- ----------------------------------------------------------------------------
-- 시드 — Visitor 18문항 설문 (V_20.02).
-- 필수 12: 핵심 axis 4 + 마케팅 5 + NPS + 향후수신 + 동의
-- 선택  6: 연락처 3 + 상세 axis 2 + 자유 텍스트 1
-- ----------------------------------------------------------------------------
INSERT INTO surveys (id, title, description, target_audience, estimated_minutes, created_by)
VALUES (
  'survey_v1_visitor',
  'HD건설기계 — Visitor 부스 설문 v1',
  '부스 방문객 18문항 (필수 12 + 선택 6). 익명 응답 가능, 옵트인 연락처.',
  'visitor',
  2,
  'manual_seed'
) ON CONFLICT (id) DO NOTHING;

-- 필수 1~4 — 핵심 axis (Dealer의 6 axis 중 4개)
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, sort_order, required)
VALUES
  ('q_v1v_scale', 'survey_v1_visitor', 'single_select',
    'Размер компании', 'Company size', '회사 규모', 'scale',
    '[
      {"value":"S","label_ru":"до 50","label_en":"≤50","label_ko":"~50인"},
      {"value":"M","label_ru":"51—200","label_en":"51—200","label_ko":"51~200"},
      {"value":"L","label_ru":"201—1000","label_en":"201—1000","label_ko":"201~1000"},
      {"value":"XL","label_ru":"1000+","label_en":"1000+","label_ko":"1000+"}
    ]'::jsonb, 1, true),
  ('q_v1v_usage', 'survey_v1_visitor', 'single_select',
    'Основное применение', 'Primary usage', '주요 용도', 'usage',
    '[
      {"value":"mining","label_ru":"Горнодобыча","label_en":"Mining","label_ko":"광업"},
      {"value":"construction_heavy","label_ru":"Крупное строит.","label_en":"Heavy construction","label_ko":"대형 건설"},
      {"value":"agriculture","label_ru":"С/х","label_en":"Agriculture","label_ko":"농업"},
      {"value":"forestry","label_ru":"Лесное хоз-во","label_en":"Forestry","label_ko":"임업"},
      {"value":"general_construction","label_ru":"Общ. строит.","label_en":"General constr.","label_ko":"일반 건설"},
      {"value":"rental","label_ru":"Аренда","label_en":"Rental","label_ko":"렌탈"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"}
    ]'::jsonb, 2, true),
  ('q_v1v_fleet', 'survey_v1_visitor', 'single_select',
    'Парк техники', 'Fleet size', '보유 장비', 'fleet_size',
    '[
      {"value":"0","label_ru":"0","label_en":"0","label_ko":"0"},
      {"value":"1-3","label_ru":"1—3","label_en":"1—3","label_ko":"1~3"},
      {"value":"4-10","label_ru":"4—10","label_en":"4—10","label_ko":"4~10"},
      {"value":"11+","label_ru":"11+","label_en":"11+","label_ko":"11+"}
    ]'::jsonb, 3, true),
  ('q_v1v_role', 'survey_v1_visitor', 'single_select',
    'Ваша роль в решении', 'Decision role', '의사결정 역할', 'decision_role',
    '[
      {"value":"owner","label_ru":"Владелец","label_en":"Owner","label_ko":"오너"},
      {"value":"purchaser","label_ru":"Закупщик","label_en":"Purchaser","label_ko":"구매"},
      {"value":"influencer","label_ru":"Влияющий","label_en":"Influencer","label_ko":"영향자"},
      {"value":"user","label_ru":"Оператор","label_en":"User","label_ko":"사용자"}
    ]'::jsonb, 4, true)
ON CONFLICT (id) DO NOTHING;

-- 필수 5~9 — 마케팅 5
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, options, sort_order, required)
VALUES
  ('q_v1v_sat', 'survey_v1_visitor', 'scale_1_5',
    'Удовлетворённость текущей техникой', 'Satisfaction with current equipment',
    '현재 장비 만족도', NULL, 5, true),
  ('q_v1v_plan', 'survey_v1_visitor', 'single_select',
    'План закупки в течение года', '1-year purchase plan', '1년 내 구매 계획',
    '[
      {"value":"yes","label_ru":"Да","label_en":"Yes","label_ko":"예"},
      {"value":"no","label_ru":"Нет","label_en":"No","label_ko":"아니오"},
      {"value":"maybe","label_ru":"Возможно","label_en":"Maybe","label_ko":"미정"}
    ]'::jsonb, 6, true),
  ('q_v1v_factors', 'survey_v1_visitor', 'multi_select',
    'Важнейшие факторы выбора (до 3)', 'Top factors (up to 3)', '구매 결정 요소 (3개)',
    '[
      {"value":"price","label_ru":"Цена","label_en":"Price","label_ko":"가격"},
      {"value":"reliability","label_ru":"Надёжность","label_en":"Reliability","label_ko":"내구성"},
      {"value":"service","label_ru":"Сервис","label_en":"Service","label_ko":"서비스"},
      {"value":"parts","label_ru":"Запчасти","label_en":"Parts","label_ko":"부품"},
      {"value":"financing","label_ru":"Финансирование","label_en":"Financing","label_ko":"파이낸싱"},
      {"value":"residual","label_ru":"Остат. стоим.","label_en":"Resale","label_ko":"잔존가치"}
    ]'::jsonb, 7, true),
  ('q_v1v_channels', 'survey_v1_visitor', 'multi_select',
    'Каналы получения информации', 'Information channels', '정보 수집 채널',
    '[
      {"value":"trade_show","label_ru":"Выставки","label_en":"Trade shows","label_ko":"전시회"},
      {"value":"online","label_ru":"Онлайн","label_en":"Online","label_ko":"온라인"},
      {"value":"dealer","label_ru":"Дилер","label_en":"Dealer","label_ko":"딜러"},
      {"value":"peer","label_ru":"Коллеги","label_en":"Peers","label_ko":"동료 추천"}
    ]'::jsonb, 8, true),
  ('q_v1v_competitor', 'survey_v1_visitor', 'single_select',
    'Какой конкурент рассматривается', 'Competitor considered', '경쟁사 검토',
    '[
      {"value":"caterpillar","label_ru":"Caterpillar","label_en":"Caterpillar","label_ko":"Caterpillar"},
      {"value":"komatsu","label_ru":"Komatsu","label_en":"Komatsu","label_ko":"Komatsu"},
      {"value":"volvo","label_ru":"Volvo","label_en":"Volvo","label_ko":"Volvo"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"},
      {"value":"none","label_ru":"Никто","label_en":"None","label_ko":"없음"}
    ]'::jsonb, 9, true)
ON CONFLICT (id) DO NOTHING;

-- 필수 10~12 — NPS · 향후 수신 동의 · 데이터 수집 동의
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, sort_order, required)
VALUES
  ('q_v1v_nps', 'survey_v1_visitor', 'nps',
    'Готовы рекомендовать HD коллегам (0—10)',
    'Recommend HD to peers (0—10)',
    'HD를 동료에게 추천 (0~10)', 10, true),
  ('q_v1v_subscribe', 'survey_v1_visitor', 'consent',
    'Подписаться на дальнейшие обновления',
    'Subscribe to future updates',
    '향후 업데이트 수신 동의', 11, true),
  ('q_v1v_consent', 'survey_v1_visitor', 'consent',
    'Согласие на обработку данных',
    'Data processing consent',
    '개인정보 처리 동의 (필수)', 12, true)
ON CONFLICT (id) DO NOTHING;

-- 선택 13~15 — 연락처 (옵트인 후 표시)
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, sort_order, required)
VALUES
  ('q_v1v_name',  'survey_v1_visitor', 'text_short',
    'Ваше имя', 'Your name', '성함', 13, false),
  ('q_v1v_phone', 'survey_v1_visitor', 'text_short',
    'Телефон',  'Phone',     '연락처', 14, false),
  ('q_v1v_email', 'survey_v1_visitor', 'text_short',
    'E-mail',   'E-mail',    '이메일', 15, false)
ON CONFLICT (id) DO NOTHING;

-- 선택 16~17 — 상세 axis
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, sort_order, required)
VALUES
  ('q_v1v_hours', 'survey_v1_visitor', 'single_select',
    'Часы эксплуатации в год', 'Annual operating hours', '연간 가동 시간',
    'annual_operating_hours',
    '[
      {"value":"low","label_ru":"<1000ч","label_en":"<1000h","label_ko":"<1000h"},
      {"value":"mid","label_ru":"1000—3000ч","label_en":"1000—3000h","label_ko":"1000~3000h"},
      {"value":"high","label_ru":">3000ч","label_en":">3000h","label_ko":">3000h"}
    ]'::jsonb, 16, false),
  ('q_v1v_deal_rub', 'survey_v1_visitor', 'single_select',
    'Годовой объём сделок (₽)', 'Annual deal volume (RUB)', '연간 거래액 (₽)',
    'annual_deal_rub',
    '[
      {"value":"small","label_ru":"<5 млн","label_en":"<5M","label_ko":"<5M"},
      {"value":"mid","label_ru":"5—50 млн","label_en":"5—50M","label_ko":"5~50M"},
      {"value":"large","label_ru":">50 млн","label_en":">50M","label_ko":">50M"}
    ]'::jsonb, 17, false)
ON CONFLICT (id) DO NOTHING;

-- 선택 18 — 자유 텍스트
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, sort_order, required)
VALUES
  ('q_v1v_notes', 'survey_v1_visitor', 'text_long',
    'Дополнительные комментарии',
    'Additional comments',
    '추가 의견', 18, false)
ON CONFLICT (id) DO NOTHING;
