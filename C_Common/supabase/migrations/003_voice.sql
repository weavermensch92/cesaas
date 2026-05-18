-- ============================================================================
-- 003_voice.sql
-- V_Voice 채널 — surveys · survey_questions · responses · response_answers.
-- V_50_Data 스키마 (V_50.06) + 6 axis(V_50.01) + 8 segment(V_50.02) + 7질문(V_50.03).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- voice_dealer_tokens — QR로 발급된 Bearer 토큰 레지스트리.
-- 토큰 자체는 JWT (스테이트리스)이지만, revoke·event 묶음을 위해 row도 보존.
-- C_04_인증 § 3.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_dealer_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id   TEXT NOT NULL,
  event       TEXT NOT NULL,                  -- 'ctt_moscow_2026' 등
  jti         TEXT UNIQUE NOT NULL,           -- JWT id
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dealer_tokens_dealer
  ON voice_dealer_tokens (dealer_id, event);

ALTER TABLE voice_dealer_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY voice_dealer_tokens_service ON voice_dealer_tokens
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- surveys — Studio가 자연어로 생성하거나 manual seed (v1).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS surveys (
  id                  TEXT PRIMARY KEY,        -- 'survey_v1_dealer' 등
  title               TEXT NOT NULL,
  description         TEXT,
  target_audience     TEXT NOT NULL
    CHECK (target_audience IN ('dealer', 'visitor')),
  language_default    TEXT NOT NULL DEFAULT 'ru',
  languages_available TEXT[] NOT NULL DEFAULT ARRAY['ru', 'en', 'ko'],
  estimated_minutes   INT,
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'draft', 'archived')),
  created_by          TEXT,                    -- 'studio' 또는 'manual'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_surveys_updated_at
  BEFORE UPDATE ON surveys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY surveys_read_public ON surveys
  FOR SELECT TO public USING (status = 'active');
CREATE POLICY surveys_write_service ON surveys
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- survey_questions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS survey_questions (
  id          TEXT PRIMARY KEY,                -- 'q_v1d_scale' 등
  survey_id   TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
    CHECK (type IN ('single_select', 'multi_select', 'scale_1_5', 'scale_1_10', 'nps', 'text_short', 'text_long', 'number', 'slider', 'consent')),
  title_ru    TEXT NOT NULL,
  title_en    TEXT,
  title_ko    TEXT,
  axis        TEXT,                            -- scale·usage·... (V_50.01)
  options     JSONB,                           -- [{value,label_ru,label_en,label_ko}]
  required    BOOLEAN NOT NULL DEFAULT true,
  weight      REAL NOT NULL DEFAULT 1.0,
  sort_order  INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_survey
  ON survey_questions (survey_id, sort_order);

ALTER TABLE survey_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY questions_read_public ON survey_questions
  FOR SELECT TO public USING (true);
CREATE POLICY questions_write_service ON survey_questions
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- responses + response_answers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS responses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  survey_id                TEXT NOT NULL REFERENCES surveys(id),
  respondent_type          TEXT NOT NULL CHECK (respondent_type IN ('dealer', 'visitor')),
  dealer_id                TEXT,
  device_id                TEXT,
  event                    TEXT,
  language                 TEXT NOT NULL DEFAULT 'ru',

  nps                      INT CHECK (nps IS NULL OR (nps BETWEEN 0 AND 10)),
  future_subscription      BOOLEAN,
  consent_data_collection  BOOLEAN,

  segment                  TEXT,                -- 분류 결과 (R_10.05)
  segment_method           TEXT,                -- 'client_rule' | 'server_rule' | 'llm'
  segment_confidence       REAL,
  axis_data                JSONB,               -- 6 axis 값 fast access

  captured_at              TIMESTAMPTZ NOT NULL,
  region                   TEXT NOT NULL DEFAULT 'ru',
  version                  TEXT NOT NULL DEFAULT 'v1',
  source                   source_t NOT NULL DEFAULT 'dealer',
  lead_id                  UUID
);

CREATE TRIGGER trg_responses_updated_at
  BEFORE UPDATE ON responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_responses_time     ON responses (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_segment  ON responses (segment) WHERE segment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_responses_event    ON responses (event, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_dealer   ON responses (dealer_id, captured_at DESC) WHERE dealer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_responses_device   ON responses (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_responses_lead     ON responses (lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS response_answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  UUID NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL REFERENCES survey_questions(id),
  answer       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (response_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_response ON response_answers (response_id);

ALTER TABLE responses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY responses_service ON responses
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY responses_admin_read ON responses
  FOR SELECT TO public USING (is_hd_admin());

CREATE POLICY answers_service ON response_answers
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY answers_admin_read ON response_answers
  FOR SELECT TO public USING (is_hd_admin());

-- ----------------------------------------------------------------------------
-- save_response — Bearer/Anonymous에서 호출 — Edge Function이 service_role 권한으로 RPC.
-- 같은 (survey_id, dealer_id|device_id, captured_at) 중복 시 첫 응답 반환 (idempotency 보조).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_response(
  p_survey_id       TEXT,
  p_respondent_type TEXT,
  p_dealer_id       TEXT,
  p_device_id       TEXT,
  p_event           TEXT,
  p_language        TEXT,
  p_nps             INT,
  p_future_subscription BOOLEAN,
  p_consent         BOOLEAN,
  p_segment         TEXT,
  p_segment_method  TEXT,
  p_segment_conf    REAL,
  p_axis_data       JSONB,
  p_answers         JSONB,
  p_captured_at     TIMESTAMPTZ
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
    captured_at, source
  ) VALUES (
    p_survey_id, p_respondent_type, p_dealer_id, p_device_id, p_event, COALESCE(p_language, 'ru'),
    p_nps, p_future_subscription, p_consent,
    p_segment, p_segment_method, p_segment_conf, p_axis_data,
    p_captured_at, p_respondent_type::source_t
  )
  RETURNING id INTO _resp_id;

  -- p_answers = [{"question_id": "...", "answer": ...}, ...]
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

COMMENT ON FUNCTION save_response IS
  'Voice 응답 저장 — responses + response_answers 한 트랜잭션. Edge Function이 호출.';

-- ----------------------------------------------------------------------------
-- v1 시드 — Dealer 설문 (6 axis + 7 marketing + NPS + consent).
-- Studio v1이 동적 생성하기 전 최소 시드. 운영 변경은 Studio publish로.
-- ----------------------------------------------------------------------------
INSERT INTO surveys (id, title, description, target_audience, estimated_minutes, created_by)
VALUES (
  'survey_v1_dealer',
  'HD건설기계 — Dealer 인터뷰 v1',
  'CTT Moscow 2026 부스 딜러 31문항 인터뷰',
  'dealer',
  5,
  'manual_seed'
) ON CONFLICT (id) DO NOTHING;

-- 6 axis
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, axis, options, sort_order)
VALUES
  ('q_v1d_scale', 'survey_v1_dealer', 'single_select',
    'Размер компании',
    'Company size',
    '회사 규모',
    'scale',
    '[
      {"value":"S","label_ru":"до 50","label_en":"≤50","label_ko":"~50인"},
      {"value":"M","label_ru":"51—200","label_en":"51—200","label_ko":"51~200"},
      {"value":"L","label_ru":"201—1000","label_en":"201—1000","label_ko":"201~1000"},
      {"value":"XL","label_ru":"1000+","label_en":"1000+","label_ko":"1000+"}
    ]'::jsonb, 1),
  ('q_v1d_usage', 'survey_v1_dealer', 'single_select',
    'Основное применение',
    'Primary usage',
    '주요 용도',
    'usage',
    '[
      {"value":"mining","label_ru":"Горнодобыча","label_en":"Mining","label_ko":"광업"},
      {"value":"construction_heavy","label_ru":"Крупное строит.","label_en":"Heavy construction","label_ko":"대형 건설"},
      {"value":"agriculture","label_ru":"С/х","label_en":"Agriculture","label_ko":"농업"},
      {"value":"forestry","label_ru":"Лесное хоз-во","label_en":"Forestry","label_ko":"임업"},
      {"value":"general_construction","label_ru":"Общ. строит.","label_en":"General constr.","label_ko":"일반 건설"},
      {"value":"rental","label_ru":"Аренда","label_en":"Rental","label_ko":"렌탈"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"}
    ]'::jsonb, 2),
  ('q_v1d_hours', 'survey_v1_dealer', 'single_select',
    'Часы эксплуатации в год',
    'Annual operating hours',
    '연간 가동 시간',
    'annual_operating_hours',
    '[
      {"value":"low","label_ru":"<1000ч","label_en":"<1000h","label_ko":"<1000h"},
      {"value":"mid","label_ru":"1000—3000ч","label_en":"1000—3000h","label_ko":"1000~3000h"},
      {"value":"high","label_ru":">3000ч","label_en":">3000h","label_ko":">3000h"}
    ]'::jsonb, 3),
  ('q_v1d_deal_rub', 'survey_v1_dealer', 'single_select',
    'Годовой объём сделок (₽)',
    'Annual deal volume (RUB)',
    '연간 거래액 (₽)',
    'annual_deal_rub',
    '[
      {"value":"small","label_ru":"<5 млн","label_en":"<5M","label_ko":"<5M"},
      {"value":"mid","label_ru":"5—50 млн","label_en":"5—50M","label_ko":"5~50M"},
      {"value":"large","label_ru":">50 млн","label_en":">50M","label_ko":">50M"}
    ]'::jsonb, 4),
  ('q_v1d_fleet', 'survey_v1_dealer', 'single_select',
    'Парк техники',
    'Fleet size',
    '보유 장비',
    'fleet_size',
    '[
      {"value":"0","label_ru":"0","label_en":"0","label_ko":"0"},
      {"value":"1-3","label_ru":"1—3","label_en":"1—3","label_ko":"1~3"},
      {"value":"4-10","label_ru":"4—10","label_en":"4—10","label_ko":"4~10"},
      {"value":"11+","label_ru":"11+","label_en":"11+","label_ko":"11+"}
    ]'::jsonb, 5),
  ('q_v1d_role', 'survey_v1_dealer', 'single_select',
    'Ваша роль в решении',
    'Decision role',
    '의사결정 역할',
    'decision_role',
    '[
      {"value":"owner","label_ru":"Владелец","label_en":"Owner","label_ko":"오너"},
      {"value":"purchaser","label_ru":"Закупщик","label_en":"Purchaser","label_ko":"구매"},
      {"value":"influencer","label_ru":"Влияющий","label_en":"Influencer","label_ko":"영향자"},
      {"value":"user","label_ru":"Оператор","label_en":"User","label_ko":"사용자"}
    ]'::jsonb, 6)
ON CONFLICT (id) DO NOTHING;

-- 7 marketing
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, options, sort_order)
VALUES
  ('q_v1d_sat', 'survey_v1_dealer', 'scale_1_5',
    'Удовлетворённость текущей техникой',
    'Satisfaction with current equipment',
    '현재 장비 만족도', NULL, 7),
  ('q_v1d_plan', 'survey_v1_dealer', 'single_select',
    'План закупки в течение года',
    '1-year purchase plan',
    '1년 내 구매 계획',
    '[
      {"value":"yes","label_ru":"Да","label_en":"Yes","label_ko":"예"},
      {"value":"no","label_ru":"Нет","label_en":"No","label_ko":"아니오"},
      {"value":"maybe","label_ru":"Возможно","label_en":"Maybe","label_ko":"미정"}
    ]'::jsonb, 8),
  ('q_v1d_factors', 'survey_v1_dealer', 'multi_select',
    'Важнейшие факторы выбора (до 3)',
    'Top factors (up to 3)',
    '구매 결정 요소 (3개)',
    '[
      {"value":"price","label_ru":"Цена","label_en":"Price","label_ko":"가격"},
      {"value":"reliability","label_ru":"Надёжность","label_en":"Reliability","label_ko":"내구성"},
      {"value":"service","label_ru":"Сервис","label_en":"Service","label_ko":"서비스"},
      {"value":"parts","label_ru":"Запчасти","label_en":"Parts","label_ko":"부품"},
      {"value":"financing","label_ru":"Финансирование","label_en":"Financing","label_ko":"파이낸싱"},
      {"value":"residual","label_ru":"Остат. стоим.","label_en":"Resale","label_ko":"잔존가치"}
    ]'::jsonb, 9),
  ('q_v1d_channels', 'survey_v1_dealer', 'multi_select',
    'Каналы получения информации',
    'Information channels',
    '정보 수집 채널',
    '[
      {"value":"trade_show","label_ru":"Выставки","label_en":"Trade shows","label_ko":"전시회"},
      {"value":"online","label_ru":"Онлайн","label_en":"Online","label_ko":"온라인"},
      {"value":"dealer","label_ru":"Дилер","label_en":"Dealer","label_ko":"딜러"},
      {"value":"peer","label_ru":"Коллеги","label_en":"Peers","label_ko":"동료 추천"}
    ]'::jsonb, 10),
  ('q_v1d_competitor', 'survey_v1_dealer', 'single_select',
    'Какой конкурент рассматривается',
    'Competitor considered',
    '경쟁사 검토',
    '[
      {"value":"caterpillar","label_ru":"Caterpillar","label_en":"Caterpillar","label_ko":"Caterpillar"},
      {"value":"komatsu","label_ru":"Komatsu","label_en":"Komatsu","label_ko":"Komatsu"},
      {"value":"volvo","label_ru":"Volvo","label_en":"Volvo","label_ko":"Volvo"},
      {"value":"other","label_ru":"Другое","label_en":"Other","label_ko":"기타"},
      {"value":"none","label_ru":"Никто","label_en":"None","label_ko":"없음"}
    ]'::jsonb, 11),
  ('q_v1d_value', 'survey_v1_dealer', 'slider',
    'Цена ↔ Качество (1 цена / 5 качество)',
    'Price ↔ Quality (1 price / 5 quality)',
    '가격 ↔ 품질 (1 가격 / 5 품질)',
    '{"min":1,"max":5,"step":1}'::jsonb, 12),
  ('q_v1d_service', 'survey_v1_dealer', 'multi_select',
    'Ожидания от сервиса',
    'Service expectations',
    '서비스 기대',
    '[
      {"value":"uptime","label_ru":"Без простоя","label_en":"Uptime","label_ko":"가동률"},
      {"value":"parts_speed","label_ru":"Скорость запч.","label_en":"Parts speed","label_ko":"부품 속도"},
      {"value":"24_7","label_ru":"24/7","label_en":"24/7","label_ko":"24/7"},
      {"value":"training","label_ru":"Обучение","label_en":"Training","label_ko":"교육"}
    ]'::jsonb, 13)
ON CONFLICT (id) DO NOTHING;

-- NPS + consent + future_subscription
INSERT INTO survey_questions (id, survey_id, type, title_ru, title_en, title_ko, sort_order)
VALUES
  ('q_v1d_nps',     'survey_v1_dealer', 'nps',
    'Насколько вы готовы рекомендовать HD коллегам (0—10)',
    'How likely to recommend HD (0—10)',
    'HD를 동료에게 추천 (0~10)', 14),
  ('q_v1d_subscribe', 'survey_v1_dealer', 'consent',
    'Подписаться на дальнейшие обновления',
    'Subscribe to future updates',
    '향후 업데이트 수신 동의', 15),
  ('q_v1d_consent', 'survey_v1_dealer', 'consent',
    'Согласие на обработку данных',
    'Data processing consent',
    '개인정보 처리 동의', 16)
ON CONFLICT (id) DO NOTHING;
