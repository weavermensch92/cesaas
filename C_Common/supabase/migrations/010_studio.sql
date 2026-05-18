-- ============================================================================
-- 010_studio.sql
-- V_60 Studio — 자연어 → 설문 빌드 + 배포.
-- - studio_drafts: 자연어 입력·LLM 결과·검토 상태 누적
-- - deploy_survey  RPC: surveys + survey_questions 트랜잭션 안전 INSERT + 이전 archive
-- ============================================================================

CREATE TABLE IF NOT EXISTS studio_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  actor           TEXT NOT NULL,                  -- 위버 이메일
  target_audience TEXT NOT NULL CHECK (target_audience IN ('dealer','visitor')),

  input_text      TEXT NOT NULL,                  -- 자연어 입력
  language        TEXT NOT NULL DEFAULT 'ko',     -- 입력 언어 (위버 작업 ko 디폴트)

  -- LLM 결과
  llm_model           TEXT,
  llm_prompt_version  TEXT,
  llm_rule_version    TEXT,
  llm_raw             TEXT,                       -- text 원본
  llm_spec            JSONB,                      -- 파싱된 SurveySpec

  -- 위버 검토 후 최종 spec (배포 직전)
  final_spec      JSONB,

  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'deployed', 'discarded')),
  deployed_survey_id TEXT REFERENCES surveys(id)
);

CREATE INDEX IF NOT EXISTS idx_drafts_actor   ON studio_drafts (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_status  ON studio_drafts (status, created_at DESC);

CREATE TRIGGER trg_drafts_updated_at
  BEFORE UPDATE ON studio_drafts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE studio_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY drafts_service ON studio_drafts
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY drafts_admin_read ON studio_drafts
  FOR SELECT TO public USING (is_hd_admin());

-- ----------------------------------------------------------------------------
-- deploy_survey — SurveySpec JSON을 받아 surveys + survey_questions 한 트랜잭션.
-- 이전 active 같은 target은 archived.
--
-- 입력 spec 형식:
--   {
--     "id"?: string,                  # 없으면 자동 생성
--     "title": string,
--     "description"?: string,
--     "language_default"?: 'ru'|'en'|'ko',
--     "estimated_minutes"?: int,
--     "questions": [{
--       "id"?: string,
--       "type": single_select|multi_select|scale_1_5|scale_1_10|nps|text_short|text_long|number|slider|consent,
--       "title_ru": string,
--       "title_en"?: string, "title_ko"?: string,
--       "axis"?: string,
--       "options"?: [{value,label_ru,label_en,label_ko}],
--       "required"?: bool,
--       "weight"?: real,
--       "sort_order"?: int
--     }]
--   }
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deploy_survey(
  p_target          TEXT,
  p_spec            JSONB,
  p_actor           TEXT,
  p_archive_previous BOOLEAN DEFAULT true,
  p_draft_id        UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  _survey_id    TEXT;
  _slug         TEXT;
  _stamp        TEXT;
  _q            JSONB;
  _idx          INT := 1;
  _qid          TEXT;
BEGIN
  IF p_target NOT IN ('dealer','visitor') THEN
    RAISE EXCEPTION 'target must be dealer|visitor' USING ERRCODE = '22023';
  END IF;
  IF p_spec IS NULL OR jsonb_typeof(p_spec -> 'questions') <> 'array' THEN
    RAISE EXCEPTION 'spec.questions array required' USING ERRCODE = '22023';
  END IF;

  -- id 결정
  _stamp := to_char(now(), 'YYYYMMDDHH24MISS');
  _slug := COALESCE(NULLIF(p_spec ->> 'slug', ''), 'studio');
  _slug := regexp_replace(_slug, '[^a-zA-Z0-9_-]+', '_', 'g');
  _survey_id := COALESCE(NULLIF(p_spec ->> 'id', ''),
                         format('survey_v1_%s_%s_%s', p_target, _slug, _stamp));

  -- 이전 active 같은 target archive
  IF p_archive_previous THEN
    UPDATE surveys
       SET status = 'archived'
     WHERE target_audience = p_target
       AND status = 'active'
       AND id != _survey_id;
  END IF;

  INSERT INTO surveys (
    id, title, description, target_audience,
    language_default, estimated_minutes, status, created_by
  ) VALUES (
    _survey_id,
    COALESCE(NULLIF(p_spec ->> 'title', ''), 'Untitled survey'),
    p_spec ->> 'description',
    p_target,
    COALESCE(NULLIF(p_spec ->> 'language_default', ''), 'ru'),
    NULLIF(p_spec ->> 'estimated_minutes', '')::INT,
    'active',
    COALESCE(NULLIF(p_actor, ''), 'studio')
  )
  ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title,
        description = EXCLUDED.description,
        language_default = EXCLUDED.language_default,
        estimated_minutes = EXCLUDED.estimated_minutes,
        status = 'active',
        updated_at = now();

  -- 이전 questions 제거 (재배포 시)
  DELETE FROM survey_questions WHERE survey_id = _survey_id;

  -- 문항 INSERT
  FOR _q IN SELECT * FROM jsonb_array_elements(p_spec -> 'questions') LOOP
    _qid := COALESCE(NULLIF(_q ->> 'id', ''),
                     format('q_%s_%s', regexp_replace(_survey_id, '^survey_', ''), _idx));
    INSERT INTO survey_questions (
      id, survey_id, type, title_ru, title_en, title_ko,
      axis, options, required, weight, sort_order
    ) VALUES (
      _qid,
      _survey_id,
      _q ->> 'type',
      COALESCE(NULLIF(_q ->> 'title_ru', ''), NULLIF(_q ->> 'title_ko', ''), NULLIF(_q ->> 'title_en', ''), 'Untitled'),
      _q ->> 'title_en',
      _q ->> 'title_ko',
      _q ->> 'axis',
      _q -> 'options',
      COALESCE((_q ->> 'required')::BOOLEAN, true),
      COALESCE((_q ->> 'weight')::REAL, 1.0),
      COALESCE((_q ->> 'sort_order')::INT, _idx)
    );
    _idx := _idx + 1;
  END LOOP;

  -- draft 갱신
  IF p_draft_id IS NOT NULL THEN
    UPDATE studio_drafts
       SET status = 'deployed',
           deployed_survey_id = _survey_id,
           final_spec = p_spec
     WHERE id = p_draft_id;
  END IF;

  RETURN _survey_id;
END;
$$;

COMMENT ON FUNCTION deploy_survey(TEXT, JSONB, TEXT, BOOLEAN, UUID) IS
  'V_60.04 — surveys + survey_questions 트랜잭션 INSERT + 이전 active archive + draft 갱신.';
