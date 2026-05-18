-- ============================================================================
-- 007_normalize_queue.sql
-- S_20.04 정규화 큐 + RPC (lock_pending_queue · save_normalized_with_supersede).
-- entity_clusters.status='pending_normalize' 자동 enqueue 트리거 포함.
-- ============================================================================

CREATE TABLE IF NOT EXISTS normalize_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id   UUID NOT NULL REFERENCES entity_clusters(id) ON DELETE CASCADE,
  priority     TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('high', 'normal', 'low')),
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts     INT  NOT NULL DEFAULT 0,
  last_error   TEXT,

  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),   -- 재시도 지연 (pending이면 이 시각 이후만 픽업)
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 픽업용 부분 인덱스 — 활성 큐만
CREATE INDEX IF NOT EXISTS idx_queue_pending
  ON normalize_queue (priority, scheduled_at, enqueued_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_cluster
  ON normalize_queue (cluster_id, status);

COMMENT ON TABLE normalize_queue
  IS 'LLM 정규화 비동기 큐. pg_cron 1분마다 worker 호출 → lock_pending_queue RPC.';

ALTER TABLE normalize_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY normalize_queue_service ON normalize_queue
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY normalize_queue_admin_read ON normalize_queue
  FOR SELECT TO public USING (is_hd_admin());

-- ----------------------------------------------------------------------------
-- 트리거 — entity_clusters.status='pending_normalize'가 되면 큐 자동 enqueue.
-- 이미 큐에 pending이 있으면 추가 X (중복 방지).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_cluster_for_normalize()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pending_normalize'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    INSERT INTO normalize_queue (cluster_id, priority)
    SELECT NEW.id, 'normal'
    WHERE NOT EXISTS (
      SELECT 1 FROM normalize_queue
      WHERE cluster_id = NEW.id AND status IN ('pending', 'processing')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clusters_enqueue ON entity_clusters;
CREATE TRIGGER trg_clusters_enqueue
  AFTER INSERT OR UPDATE OF status ON entity_clusters
  FOR EACH ROW EXECUTE FUNCTION enqueue_cluster_for_normalize();

-- ----------------------------------------------------------------------------
-- lock_pending_queue — atomic SKIP LOCKED 픽업.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_pending_queue(p_limit INT)
RETURNS SETOF normalize_queue
LANGUAGE sql
AS $$
  UPDATE normalize_queue
     SET status = 'processing', started_at = now()
   WHERE id IN (
     SELECT id FROM normalize_queue
      WHERE status = 'pending'
        AND scheduled_at <= now()
      ORDER BY
        CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        enqueued_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$;

COMMENT ON FUNCTION lock_pending_queue(INT)
  IS 'normalize_queue 픽업 — priority + scheduled_at 우선, SKIP LOCKED.';

-- ----------------------------------------------------------------------------
-- requeue_queue_item — 재시도 (5분·30분 지연) 또는 failed 마킹.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION requeue_queue_item(
  p_id        UUID,
  p_error     TEXT,
  p_max_tries INT DEFAULT 3
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  _attempts INT;
  _delay_min INT;
  _next_status TEXT;
BEGIN
  UPDATE normalize_queue
     SET attempts = attempts + 1, last_error = p_error
   WHERE id = p_id
  RETURNING attempts INTO _attempts;

  IF _attempts >= p_max_tries THEN
    UPDATE normalize_queue
       SET status = 'failed', completed_at = now()
     WHERE id = p_id;
    _next_status := 'failed';
  ELSE
    _delay_min := CASE _attempts WHEN 1 THEN 5 ELSE 30 END;
    UPDATE normalize_queue
       SET status = 'pending',
           started_at = NULL,
           scheduled_at = now() + (_delay_min || ' minutes')::interval
     WHERE id = p_id;
    _next_status := 'pending';
  END IF;

  RETURN _next_status;
END;
$$;

-- ----------------------------------------------------------------------------
-- save_normalized_with_supersede — 13 필드 적재 + 이전 active supersede +
-- entity_clusters 갱신 (트랜잭션 안전).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_normalized_with_supersede(
  p_cluster_id     UUID,
  p_fields         JSONB,
  p_confidences    JSONB,
  p_model          TEXT,
  p_prompt_version TEXT
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _new_id    UUID;
  _entity_id TEXT;
  _crm_id    TEXT;
BEGIN
  SELECT entity_id, crm_id INTO _entity_id, _crm_id
    FROM entity_clusters WHERE id = p_cluster_id;
  IF _entity_id IS NULL THEN
    RAISE EXCEPTION 'cluster % not found', p_cluster_id;
  END IF;

  INSERT INTO normalized_fields (
    cluster_id, entity_id, crm_id,
    deal_id,            deal_id_confidence,
    deal_code,          deal_code_confidence,
    company_name,       company_name_confidence,
    contact_name,       contact_name_confidence,
    contact_phone,      contact_phone_confidence,
    contact_email,      contact_email_confidence,
    amount,             currency, amount_confidence,
    stage,              stage_confidence,
    product_model,      product_model_confidence,
    region,             region_confidence,
    date_created,       date_created_confidence,
    responsible_dealer, responsible_dealer_confidence,
    model, prompt_version, status
  ) VALUES (
    p_cluster_id, _entity_id, _crm_id,
    p_fields ->> 'deal_id',             (p_confidences ->> 'deal_id')::REAL,
    p_fields ->> 'deal_code',           (p_confidences ->> 'deal_code')::REAL,
    p_fields ->> 'company_name',        (p_confidences ->> 'company_name')::REAL,
    p_fields ->> 'contact_name',        (p_confidences ->> 'contact_name')::REAL,
    p_fields ->> 'contact_phone',       (p_confidences ->> 'contact_phone')::REAL,
    p_fields ->> 'contact_email',       (p_confidences ->> 'contact_email')::REAL,
    NULLIF(p_fields ->> 'amount', '')::NUMERIC,
    p_fields ->> 'currency',
    (p_confidences ->> 'amount')::REAL,
    p_fields ->> 'stage',               (p_confidences ->> 'stage')::REAL,
    p_fields ->> 'product_model',       (p_confidences ->> 'product_model')::REAL,
    p_fields ->> 'region',              (p_confidences ->> 'region')::REAL,
    NULLIF(p_fields ->> 'date_created', '')::TIMESTAMPTZ,
    (p_confidences ->> 'date_created')::REAL,
    p_fields ->> 'responsible_dealer',  (p_confidences ->> 'responsible_dealer')::REAL,
    p_model, p_prompt_version, 'active'
  )
  RETURNING id INTO _new_id;

  -- 이전 active supersede
  UPDATE normalized_fields
     SET status = 'superseded', superseded_at = now()
   WHERE cluster_id = p_cluster_id
     AND id != _new_id
     AND status = 'active';

  -- cluster 갱신
  UPDATE entity_clusters
     SET status = 'normalized',
         normalized_fields_id = _new_id,
         normalized_at = now()
   WHERE id = p_cluster_id;

  RETURN _new_id;
END;
$$;

COMMENT ON FUNCTION save_normalized_with_supersede(UUID, JSONB, JSONB, TEXT, TEXT)
  IS 'LLM 13 필드 결과 INSERT + 이전 active supersede + cluster status=normalized.';

-- ----------------------------------------------------------------------------
-- pg_cron 등록 예시 (운영 시 SUPABASE Dashboard 또는 SQL로)
-- ----------------------------------------------------------------------------
-- SELECT cron.schedule('normalize_pump', '* * * * *', $$
--   SELECT net.http_post(
--     url := current_setting('app.functions_base_url') || '/normalize-worker',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := jsonb_build_object('batch_size', 5)
--   );
-- $$);
