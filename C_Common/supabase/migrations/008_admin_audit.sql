-- ============================================================================
-- 008_admin_audit.sql
-- Admin 수동 편집 추가 audit + 편집 RPC + 재정규화 RPC.
-- S_50.02 § 5 정확도 사이클 입력.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- normalized_field_edits — LLM ↔ 사람 차이 누적 (정확도 사이클 입력).
-- normalize_audit (002_sensor.sql)은 raw 편집 기록.
-- 이 테이블은 LLM 원본값까지 보존해 차이 분석을 직접 가능하게 함.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS normalized_field_edits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  normalized_fields_id  UUID NOT NULL REFERENCES normalized_fields(id) ON DELETE CASCADE,
  cluster_id            UUID NOT NULL REFERENCES entity_clusters(id) ON DELETE CASCADE,
  field_name            TEXT NOT NULL,
  llm_value             TEXT,
  llm_confidence        REAL,
  edited_value          TEXT,                  -- NULL = "필드 비움" (LLM 값이 잘못)
  prompt_version        TEXT,                  -- 편집 시점의 R_10.06 version
  edited_by             TEXT NOT NULL,
  reason                TEXT
);

CREATE INDEX IF NOT EXISTS idx_field_edits_normalized
  ON normalized_field_edits (normalized_fields_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_edits_field
  ON normalized_field_edits (field_name, prompt_version);

COMMENT ON TABLE normalized_field_edits
  IS 'LLM 원본값 + 편집값 동시 보존. T_07.02 정확도 사이클 분석 입력.';

ALTER TABLE normalized_field_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY field_edits_service ON normalized_field_edits
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY field_edits_admin_read ON normalized_field_edits
  FOR SELECT TO public USING (is_hd_admin());

-- ----------------------------------------------------------------------------
-- 화이트리스트 — 편집 가능한 13 필드만.
-- 컬럼명·confidence 컬럼명을 함께 반환. SQL injection 방지(동적 컬럼명 안전).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sensor_editable_columns()
RETURNS TABLE (field_name TEXT, value_col TEXT, conf_col TEXT)
LANGUAGE sql IMMUTABLE
AS $$
  VALUES
    ('deal_id',            'deal_id',            'deal_id_confidence'),
    ('deal_code',          'deal_code',          'deal_code_confidence'),
    ('company_name',       'company_name',       'company_name_confidence'),
    ('contact_name',       'contact_name',       'contact_name_confidence'),
    ('contact_phone',      'contact_phone',      'contact_phone_confidence'),
    ('contact_email',      'contact_email',      'contact_email_confidence'),
    ('amount',             'amount',             'amount_confidence'),
    ('currency',           'currency',           NULL),
    ('stage',              'stage',              'stage_confidence'),
    ('product_model',      'product_model',      'product_model_confidence'),
    ('region',             'region',             'region_confidence'),
    ('date_created',       'date_created',       'date_created_confidence'),
    ('responsible_dealer', 'responsible_dealer', 'responsible_dealer_confidence');
$$;

-- ----------------------------------------------------------------------------
-- edit_normalized_field — Admin이 단일 필드 편집.
-- 1) 화이트리스트 검증
-- 2) 기존 LLM 값을 normalized_field_edits에 보존
-- 3) normalized_fields UPDATE (edited_by/edited_at 표시)
-- 4) normalize_audit 라인 추가
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION edit_normalized_field(
  p_normalized_id UUID,
  p_field_name    TEXT,
  p_new_value     TEXT,
  p_edited_by     TEXT,
  p_reason        TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _value_col TEXT;
  _conf_col  TEXT;
  _cluster   UUID;
  _llm_value TEXT;
  _llm_conf  REAL;
  _prompt_v  TEXT;
  _edit_id   UUID;
  _sql       TEXT;
BEGIN
  SELECT value_col, conf_col
    INTO _value_col, _conf_col
    FROM sensor_editable_columns()
   WHERE field_name = p_field_name;
  IF _value_col IS NULL THEN
    RAISE EXCEPTION 'field % is not editable', p_field_name USING ERRCODE = '22023';
  END IF;

  -- 기존 LLM 값 + confidence + prompt_version 읽기 (동적 SQL — 컬럼명은 화이트리스트에서 옴)
  IF _conf_col IS NOT NULL THEN
    _sql := format(
      'SELECT cluster_id, %I::text, %I::real, prompt_version FROM normalized_fields WHERE id = $1',
      _value_col, _conf_col
    );
    EXECUTE _sql INTO _cluster, _llm_value, _llm_conf, _prompt_v USING p_normalized_id;
  ELSE
    _sql := format(
      'SELECT cluster_id, %I::text, NULL::real, prompt_version FROM normalized_fields WHERE id = $1',
      _value_col
    );
    EXECUTE _sql INTO _cluster, _llm_value, _llm_conf, _prompt_v USING p_normalized_id;
  END IF;
  IF _cluster IS NULL THEN
    RAISE EXCEPTION 'normalized_fields % not found', p_normalized_id USING ERRCODE = 'P0002';
  END IF;

  -- 편집 이력 (LLM 원본 보존)
  INSERT INTO normalized_field_edits (
    normalized_fields_id, cluster_id, field_name,
    llm_value, llm_confidence, edited_value, prompt_version,
    edited_by, reason
  ) VALUES (
    p_normalized_id, _cluster, p_field_name,
    _llm_value, _llm_conf, p_new_value, _prompt_v,
    p_edited_by, p_reason
  )
  RETURNING id INTO _edit_id;

  -- 필드 UPDATE — 값 + edited_by/edited_at 메타
  _sql := format(
    'UPDATE normalized_fields SET %I = $1, edited_by = $2, edited_at = now() WHERE id = $3',
    _value_col
  );
  EXECUTE _sql USING p_new_value, p_edited_by, p_normalized_id;

  -- 자유로운 audit (기존 normalize_audit 테이블)
  INSERT INTO normalize_audit (normalized_id, cluster_id, field, before_value, after_value, edited_by, edit_reason)
  VALUES (p_normalized_id, _cluster, p_field_name, _llm_value, p_new_value, p_edited_by, p_reason);

  RETURN _edit_id;
END;
$$;

COMMENT ON FUNCTION edit_normalized_field(UUID, TEXT, TEXT, TEXT, TEXT)
  IS 'Admin 단일 필드 편집 — 화이트리스트 + LLM 원본 보존 + audit.';

-- ----------------------------------------------------------------------------
-- enqueue_normalize_priority — Admin이 재정규화 트리거.
-- 이미 처리 중이면 noop. 큐에 high priority로 새 row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_normalize_priority(
  p_cluster_id UUID,
  p_priority   TEXT DEFAULT 'high',
  p_actor      TEXT DEFAULT NULL,
  p_reason     TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _existing UUID;
  _new_id   UUID;
BEGIN
  IF p_priority NOT IN ('high', 'normal', 'low') THEN
    RAISE EXCEPTION 'invalid priority %', p_priority USING ERRCODE = '22023';
  END IF;

  SELECT id INTO _existing
    FROM normalize_queue
   WHERE cluster_id = p_cluster_id AND status IN ('pending', 'processing')
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    -- 진행 중이면 priority만 격상
    UPDATE normalize_queue
       SET priority = p_priority,
           scheduled_at = LEAST(scheduled_at, now())
     WHERE id = _existing;
    RETURN _existing;
  END IF;

  -- cluster 상태를 pending_normalize로 되돌려 worker가 pick up
  UPDATE entity_clusters SET status = 'pending_normalize' WHERE id = p_cluster_id;

  INSERT INTO normalize_queue (cluster_id, priority, scheduled_at)
  VALUES (p_cluster_id, p_priority, now())
  RETURNING id INTO _new_id;

  -- audit (편의상 normalize_audit 사용)
  IF p_actor IS NOT NULL THEN
    INSERT INTO normalize_audit (normalized_id, cluster_id, field, before_value, after_value, edited_by, edit_reason)
    SELECT nf.id, p_cluster_id, '__retrigger__', nf.status, 'pending_normalize', p_actor,
           coalesce(p_reason, 'admin re-normalize')
      FROM normalized_fields nf
     WHERE nf.cluster_id = p_cluster_id AND nf.status = 'active'
     LIMIT 1;
  END IF;

  RETURN _new_id;
END;
$$;

COMMENT ON FUNCTION enqueue_normalize_priority(UUID, TEXT, TEXT, TEXT)
  IS 'Admin이 high priority 재정규화 트리거. 진행 중이면 priority만 격상.';
