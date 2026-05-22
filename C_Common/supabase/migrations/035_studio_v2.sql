-- ============================================================================
-- 035_studio_v2.sql
-- V_60 Studio v2 — hd-design 와이어프레임 정합화.
-- - studio_drafts: 다중 채널(brief_group_id) · 기존 수정(parent_survey_id) · 재생성(origin) · lint warnings JSONB
-- - surveys: 명시적 version_label + brief_group_id 형제 추적
-- - survey_questions: AI/edited 출처 표기
-- - deploy_survey RPC 확장 (version_label 자동 bump + brief_group_id 기록 + ai_generated/edited_at 전달)
-- 후방 호환: 기존 010_studio.sql 시그니처(p_target, p_spec, p_actor, p_archive_previous, p_draft_id)는
-- 새 인자(p_version_label, p_brief_group_id) DEFAULT NULL로 그대로 호출 가능.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- studio_drafts 확장
-- ----------------------------------------------------------------------------
ALTER TABLE studio_drafts ADD COLUMN IF NOT EXISTS brief_group_id UUID;
ALTER TABLE studio_drafts ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'fresh'
  CHECK (origin IN ('fresh','from_existing','regenerated'));
ALTER TABLE studio_drafts ADD COLUMN IF NOT EXISTS parent_survey_id TEXT REFERENCES surveys(id);
ALTER TABLE studio_drafts ADD COLUMN IF NOT EXISTS edit_notes TEXT;
ALTER TABLE studio_drafts ADD COLUMN IF NOT EXISTS warnings JSONB;

CREATE INDEX IF NOT EXISTS idx_drafts_brief_group ON studio_drafts (brief_group_id)
  WHERE brief_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drafts_parent_survey ON studio_drafts (parent_survey_id)
  WHERE parent_survey_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- surveys 확장
-- ----------------------------------------------------------------------------
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS version_label TEXT;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS brief_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_surveys_brief_group ON surveys (brief_group_id)
  WHERE brief_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_target_status ON surveys (target_audience, status);

-- ----------------------------------------------------------------------------
-- survey_questions 확장
-- ----------------------------------------------------------------------------
ALTER TABLE survey_questions ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE survey_questions ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- bump_version_label — 'X.Y' 패턴이면 Y+1, 외엔 NULL 반환 → 호출자가 fallback.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_version_label(p_prev TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  _major INT;
  _minor INT;
  _parts TEXT[];
BEGIN
  IF p_prev IS NULL OR p_prev = '' THEN RETURN '1.0'; END IF;
  _parts := regexp_match(p_prev, '^([0-9]+)\.([0-9]+)$');
  IF _parts IS NULL THEN RETURN '1.0'; END IF;
  _major := _parts[1]::INT;
  _minor := _parts[2]::INT + 1;
  RETURN format('%s.%s', _major, _minor);
END;
$$;

-- ----------------------------------------------------------------------------
-- deploy_survey v2 — 시그니처 확장(인자 2개 추가).
-- 신규 인자:
--   p_version_label   — NULL이면 동일 target_audience MAX(version_label) 자동 bump (없으면 '1.0')
--   p_brief_group_id  — 형제(dealer/visitor) 추적용 UUID
-- 신규 질문 컬럼 전달:
--   spec.questions[].ai_generated (bool, default false)
--   spec.questions[].edited_at    (ISO 8601 string, nullable)
--
-- CREATE OR REPLACE는 시그니처가 동일할 때만 in-place 교체. 인자가 추가됐으므로
-- Postgres는 별도 overload로 인식해 두 시그니처가 공존 → 호출 ambiguity.
-- 010_studio.sql의 5-arg 구버전은 명시적으로 DROP.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS deploy_survey(TEXT, JSONB, TEXT, BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION deploy_survey(
  p_target           TEXT,
  p_spec             JSONB,
  p_actor            TEXT,
  p_archive_previous BOOLEAN DEFAULT true,
  p_draft_id         UUID    DEFAULT NULL,
  p_version_label    TEXT    DEFAULT NULL,
  p_brief_group_id   UUID    DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  _survey_id     TEXT;
  _slug          TEXT;
  _stamp         TEXT;
  _q             JSONB;
  _idx           INT := 1;
  _qid           TEXT;
  _prev_label    TEXT;
  _version_label TEXT;
  _edited_at     TIMESTAMPTZ;
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

  -- version_label 결정: 명시값 우선 → 동일 target 활성 MAX → bump → 없으면 '1.0'
  IF p_version_label IS NOT NULL AND p_version_label <> '' THEN
    _version_label := p_version_label;
  ELSE
    SELECT version_label INTO _prev_label
      FROM surveys
     WHERE target_audience = p_target
       AND status = 'active'
       AND id <> _survey_id
     ORDER BY created_at DESC
     LIMIT 1;
    _version_label := bump_version_label(_prev_label);
  END IF;

  -- 이전 active 같은 target archive
  IF p_archive_previous THEN
    UPDATE surveys
       SET status = 'archived'
     WHERE target_audience = p_target
       AND status = 'active'
       AND id <> _survey_id;
  END IF;

  INSERT INTO surveys (
    id, title, description, target_audience,
    language_default, estimated_minutes, status, created_by,
    version_label, brief_group_id
  ) VALUES (
    _survey_id,
    COALESCE(NULLIF(p_spec ->> 'title', ''), 'Untitled survey'),
    p_spec ->> 'description',
    p_target,
    COALESCE(NULLIF(p_spec ->> 'language_default', ''), 'ru'),
    NULLIF(p_spec ->> 'estimated_minutes', '')::INT,
    'active',
    COALESCE(NULLIF(p_actor, ''), 'studio'),
    _version_label,
    p_brief_group_id
  )
  ON CONFLICT (id) DO UPDATE
    SET title             = EXCLUDED.title,
        description       = EXCLUDED.description,
        language_default  = EXCLUDED.language_default,
        estimated_minutes = EXCLUDED.estimated_minutes,
        status            = 'active',
        version_label     = EXCLUDED.version_label,
        brief_group_id    = COALESCE(EXCLUDED.brief_group_id, surveys.brief_group_id),
        updated_at        = now();

  -- 이전 questions 제거 (재배포 시)
  DELETE FROM survey_questions WHERE survey_id = _survey_id;

  -- 문항 INSERT
  FOR _q IN SELECT * FROM jsonb_array_elements(p_spec -> 'questions') LOOP
    _qid := COALESCE(NULLIF(_q ->> 'id', ''),
                     format('q_%s_%s', regexp_replace(_survey_id, '^survey_', ''), _idx));

    -- edited_at 파싱 (ISO 문자열 → timestamptz; 실패 시 NULL)
    BEGIN
      _edited_at := NULLIF(_q ->> 'edited_at', '')::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      _edited_at := NULL;
    END;

    INSERT INTO survey_questions (
      id, survey_id, type, title_ru, title_en, title_ko,
      axis, options, required, weight, sort_order,
      ai_generated, edited_at
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
      COALESCE((_q ->> 'sort_order')::INT, _idx),
      COALESCE((_q ->> 'ai_generated')::BOOLEAN, false),
      _edited_at
    );
    _idx := _idx + 1;
  END LOOP;

  -- draft 갱신
  IF p_draft_id IS NOT NULL THEN
    UPDATE studio_drafts
       SET status              = 'deployed',
           deployed_survey_id  = _survey_id,
           final_spec          = p_spec
     WHERE id = p_draft_id;
  END IF;

  RETURN _survey_id;
END;
$$;

COMMENT ON FUNCTION deploy_survey(TEXT, JSONB, TEXT, BOOLEAN, UUID, TEXT, UUID) IS
  'V_60.04 v2 — surveys + survey_questions 트랜잭션 INSERT + 이전 active archive + version_label 자동 bump + brief_group_id 추적.';
