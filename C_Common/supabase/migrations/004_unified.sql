-- ============================================================================
-- 004_unified.sql
-- U_Unified — Lead 자동 응집·LeadScoring·DealerOutput.
-- v1 시드. v2엔 Linkage 다대다·시간순 타임라인 확장.
--
-- 데이터 흐름:
--   captures (Sensor) ──┐
--                       ├─ entity_id ──→ leads ──→ score_lead → dealer_outputs
--   responses (Voice) ──┘                                          (Playbook)
-- ============================================================================

CREATE TABLE IF NOT EXISTS leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 공통 (C_02_DB § 2)
  crm_id          TEXT NOT NULL,
  entity_id       TEXT,                          -- NULL = unassociated
  region          TEXT NOT NULL DEFAULT 'ru',
  version         TEXT NOT NULL DEFAULT 'v1',

  -- 응집 메타
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sensor_count    INT NOT NULL DEFAULT 0,
  voice_count     INT NOT NULL DEFAULT 0,

  -- 점수·우선순위 (R_10.01)
  score           INT,                            -- 0~100
  priority        TEXT,                           -- P1·P2·P3·P4·P5
  score_at        TIMESTAMPTZ,
  score_version   TEXT,                           -- R_10.01 yaml version 스냅샷

  -- 요약 (최신 normalized + 최신 voice)
  segment         TEXT,
  company_name    TEXT,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  amount          NUMERIC,
  currency        TEXT,
  stage           TEXT,
  product_model   TEXT,

  -- 라이프사이클
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'merged')),
  merged_into     UUID REFERENCES leads(id) ON DELETE SET NULL,
  notes           TEXT,

  UNIQUE (entity_id, crm_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_score    ON leads (score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads (priority, score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leads_segment  ON leads (segment) WHERE segment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads (status, last_seen_at DESC);

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE leads IS
  'Sensor + Voice 응집 단위. (entity_id, crm_id) 기준 1 row. score는 R_10.01 가중치 적용.';

-- 002·003·007에서 lead_id 컬럼이 이미 있고 FK 없음 — 이제 FK 추가
ALTER TABLE captures        ADD CONSTRAINT fk_captures_lead        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE entity_clusters ADD CONSTRAINT fk_entity_clusters_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE responses       ADD CONSTRAINT fk_responses_lead       FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- lead_links — Sensor·Voice 어느 row가 어느 Lead에 묶였는지 (audit + v2 다대다 시드)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL CHECK (source_table IN ('entity_clusters', 'responses')),
  source_id    UUID NOT NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_links_lead ON lead_links (lead_id);

COMMENT ON TABLE lead_links IS
  'v1 단순 1:N 매핑. v2엔 다대다 + 시간순 변화.';

-- ----------------------------------------------------------------------------
-- dealer_outputs — R_10.07 Playbook 발급 이력
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer_outputs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  segment       TEXT NOT NULL,
  priority      TEXT NOT NULL,
  score_snapshot INT,

  -- Playbook payload (R_10.07 미러)
  title         TEXT,
  weapons       JSONB,            -- {ru:[],en:[],ko:[]}
  pitch         JSONB,            -- {ru,en,ko}
  models        TEXT[],
  next_action   JSONB,            -- {ru,en,ko}

  source        TEXT NOT NULL DEFAULT 'rule'
    CHECK (source IN ('rule', 'llm')),
  rule_version  TEXT,
  model         TEXT,

  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded'))
);

CREATE INDEX IF NOT EXISTS idx_outputs_lead   ON dealer_outputs (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outputs_active ON dealer_outputs (lead_id) WHERE status = 'active';

COMMENT ON TABLE dealer_outputs IS
  '딜러에게 발급된 Playbook (R_10.07). Lead당 active 1개 권장.';

-- ----------------------------------------------------------------------------
-- score_lead — R_10.01 LeadScoring 미러.
-- C_Common/r_10_rules/R_10.01_LeadScoring.yaml 의 weights 스냅샷.
-- 변경 시 publish_rule + 이 함수 + score_version 동시 갱신.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION score_lead(p_lead_id UUID)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  _lead      leads%ROWTYPE;
  _nf        normalized_fields%ROWTYPE;
  _voice_nps NUMERIC;
  _voice_axis JSONB;
  _voice_seg  TEXT;
  _score     INT := 0;
  _priority  TEXT;
BEGIN
  SELECT * INTO _lead FROM leads WHERE id = p_lead_id;
  IF _lead.id IS NULL THEN RETURN 0; END IF;

  -- Sensor: 최신 active normalized
  SELECT * INTO _nf
    FROM normalized_fields
   WHERE cluster_id IN (
           SELECT id FROM entity_clusters
            WHERE entity_id = _lead.entity_id AND crm_id = _lead.crm_id
         )
     AND status = 'active'
   ORDER BY created_at DESC LIMIT 1;

  -- Voice: 최신 응답 (axis_data·NPS·segment)
  SELECT axis_data, nps, segment
    INTO _voice_axis, _voice_nps, _voice_seg
    FROM responses
   WHERE lead_id = p_lead_id
   ORDER BY captured_at DESC LIMIT 1;

  -- Sensor 가중치 (R_10.01.weights.sensor)
  IF _nf.id IS NOT NULL THEN
    IF _nf.company_name        IS NOT NULL THEN _score := _score + 4; END IF;
    IF _nf.contact_name        IS NOT NULL THEN _score := _score + 4; END IF;
    IF _nf.contact_phone       IS NOT NULL THEN _score := _score + 4; END IF;
    IF _nf.contact_email       IS NOT NULL THEN _score := _score + 4; END IF;
    IF _nf.region              IS NOT NULL THEN _score := _score + 3; END IF;
    IF _nf.product_model       IS NOT NULL THEN _score := _score + 10; END IF;
    IF _nf.amount              IS NOT NULL THEN _score := _score + 12; END IF;
    IF _nf.stage               IS NOT NULL THEN _score := _score + 8; END IF;
    IF _nf.responsible_dealer  IS NOT NULL THEN _score := _score + 5; END IF;
  END IF;

  -- Voice 가중치 (R_10.01.weights.voice)
  IF _voice_axis IS NOT NULL THEN
    IF _voice_axis ? 'scale'                 THEN _score := _score + 10; END IF;
    IF _voice_axis ? 'usage'                 THEN _score := _score + 8;  END IF;
    IF _voice_axis ? 'annual_deal_rub'       THEN _score := _score + 10; END IF;
    IF _voice_axis ? 'annual_operating_hours'THEN _score := _score + 8;  END IF;
    IF _voice_axis ? 'decision_role'         THEN _score := _score + 4;  END IF;
    IF _voice_nps  IS NOT NULL               THEN _score := _score + 4;  END IF;
  END IF;

  -- Unified 보정
  IF _lead.sensor_count > 0 AND _lead.voice_count > 0 THEN
    _score := _score + 10;                              -- same_entity_match
  END IF;
  IF _lead.sensor_count > 0 THEN _score := _score + 5; END IF;  -- has_sensor
  IF _lead.voice_count  > 0 THEN _score := _score + 5; END IF;  -- has_voice

  -- 큰 거래액·고가동 시간 보너스 (annual_deal_rub == 'large' / hours == 'high')
  IF _voice_axis ->> 'annual_deal_rub' = 'large' THEN _score := _score + 8; END IF;
  IF _voice_axis ->> 'annual_operating_hours' = 'high' THEN _score := _score + 6; END IF;

  -- 30일 이상 묵힌 capture 페널티
  IF _nf.id IS NOT NULL AND _nf.created_at < now() - interval '30 days' THEN
    _score := _score - 8;
  END IF;

  _score := GREATEST(0, LEAST(100, _score));

  _priority := CASE
    WHEN _score >= 85 THEN 'P1'
    WHEN _score >= 70 THEN 'P2'
    WHEN _score >= 55 THEN 'P3'
    WHEN _score >= 40 THEN 'P4'
    ELSE 'P5'
  END;

  UPDATE leads
     SET score = _score,
         priority = _priority,
         score_at = now(),
         score_version = COALESCE(score_version, 'r10.01@0.1')
   WHERE id = p_lead_id;

  RETURN _score;
END;
$$;

COMMENT ON FUNCTION score_lead(UUID) IS
  'R_10.01_LeadScoring.yaml 가중치 미러. 변경 시 score_version도 같이.';

-- ----------------------------------------------------------------------------
-- generate_dealer_output — R_10.07 Playbook을 lead.segment + priority 기준으로 발급.
-- 기존 active → superseded, 새 active row 1개.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_dealer_output(p_lead_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _lead    leads%ROWTYPE;
  _new_id  UUID;
BEGIN
  SELECT * INTO _lead FROM leads WHERE id = p_lead_id;
  IF _lead.id IS NULL THEN
    RAISE EXCEPTION 'lead % not found', p_lead_id USING ERRCODE = 'P0002';
  END IF;
  IF _lead.segment IS NULL OR _lead.priority IS NULL THEN
    RETURN NULL;                                       -- 아직 점수 산출 안 됨
  END IF;

  -- 기존 active supersede
  UPDATE dealer_outputs
     SET status = 'superseded'
   WHERE lead_id = p_lead_id AND status = 'active';

  -- R_10.07 골조 — 실 payload는 클라이언트(Dealer HTML)의 PLAYBOOKS 와 동일.
  -- 여기는 segment + priority 만 기록. 풀 텍스트는 R_10.07 YAML이 ground truth.
  INSERT INTO dealer_outputs (
    lead_id, segment, priority, score_snapshot,
    title, source, rule_version
  ) VALUES (
    p_lead_id, _lead.segment, _lead.priority, _lead.score,
    format('Playbook · %s · %s', _lead.segment, _lead.priority),
    'rule', 'r10.07@0.1'
  )
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- upsert_lead_from_cluster — 클러스터(=entity)별 leads UPSERT + linkage 등록.
-- normalized_fields INSERT 직후 트리거가 호출.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_lead_from_cluster(p_cluster_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _entity TEXT; _crm TEXT; _lead_id UUID;
  _nf     normalized_fields%ROWTYPE;
  _seg    TEXT;
BEGIN
  SELECT entity_id, crm_id INTO _entity, _crm
    FROM entity_clusters WHERE id = p_cluster_id;
  IF _entity IS NULL THEN RETURN NULL; END IF;

  -- 최신 active normalized
  SELECT * INTO _nf
    FROM normalized_fields
   WHERE cluster_id = p_cluster_id AND status = 'active'
   ORDER BY created_at DESC LIMIT 1;

  -- segment는 voice 우선, sensor 측엔 segment 컬럼 없음 → NULL
  INSERT INTO leads (
    crm_id, entity_id, region, version, sensor_count, voice_count,
    company_name, contact_name, contact_phone, contact_email,
    amount, currency, stage, product_model,
    last_seen_at
  ) VALUES (
    _crm, _entity, 'ru', 'v1', 1, 0,
    _nf.company_name, _nf.contact_name, _nf.contact_phone, _nf.contact_email,
    _nf.amount, _nf.currency, _nf.stage, _nf.product_model,
    now()
  )
  ON CONFLICT (entity_id, crm_id) DO UPDATE SET
    sensor_count   = leads.sensor_count + 1,
    company_name   = COALESCE(EXCLUDED.company_name,   leads.company_name),
    contact_name   = COALESCE(EXCLUDED.contact_name,   leads.contact_name),
    contact_phone  = COALESCE(EXCLUDED.contact_phone,  leads.contact_phone),
    contact_email  = COALESCE(EXCLUDED.contact_email,  leads.contact_email),
    amount         = COALESCE(EXCLUDED.amount,         leads.amount),
    currency       = COALESCE(EXCLUDED.currency,       leads.currency),
    stage          = COALESCE(EXCLUDED.stage,          leads.stage),
    product_model  = COALESCE(EXCLUDED.product_model,  leads.product_model),
    last_seen_at   = now()
  RETURNING id INTO _lead_id;

  -- linkage
  INSERT INTO lead_links (lead_id, source_table, source_id)
  VALUES (_lead_id, 'entity_clusters', p_cluster_id)
  ON CONFLICT (source_table, source_id) DO NOTHING;

  -- 역방향 FK 갱신
  UPDATE entity_clusters SET lead_id = _lead_id WHERE id = p_cluster_id;
  UPDATE captures        SET lead_id = _lead_id
   WHERE entity_id = _entity AND crm_id = _crm AND lead_id IS NULL;

  -- score + playbook
  PERFORM score_lead(_lead_id);
  PERFORM generate_dealer_output(_lead_id);

  RETURN _lead_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- upsert_lead_from_response — Voice 응답 → leads UPSERT.
-- entity_id 없으면 (회사명·dealer_id 기반) lookup 시도. 못 찾으면 unassociated row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_lead_from_response(p_response_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _r       responses%ROWTYPE;
  _lead_id UUID;
  _entity  TEXT;
  _crm     TEXT := 'bitrix24';
  _company TEXT;
BEGIN
  SELECT * INTO _r FROM responses WHERE id = p_response_id;
  IF _r.id IS NULL THEN RETURN NULL; END IF;

  -- entity_id가 axis_data에 있으면 사용 (Dealer가 명시적으로 채운 경우)
  _entity := _r.axis_data ->> 'entity_id';

  -- 회사명으로 기존 lead lookup (이름 기반 fuzzy 매칭은 v2)
  _company := _r.contact_name;  -- visitor 옵트인 시 사용 가능

  IF _entity IS NOT NULL THEN
    -- 동일 entity_id의 lead UPSERT
    INSERT INTO leads (
      crm_id, entity_id, region, version, sensor_count, voice_count,
      segment, contact_name, contact_phone, contact_email,
      last_seen_at
    ) VALUES (
      _crm, _entity, COALESCE(_r.region,'ru'), COALESCE(_r.version,'v1'), 0, 1,
      _r.segment, _r.contact_name, _r.contact_phone, _r.contact_email,
      _r.captured_at
    )
    ON CONFLICT (entity_id, crm_id) DO UPDATE SET
      voice_count    = leads.voice_count + 1,
      segment        = COALESCE(EXCLUDED.segment,       leads.segment),
      contact_name   = COALESCE(EXCLUDED.contact_name,  leads.contact_name),
      contact_phone  = COALESCE(EXCLUDED.contact_phone, leads.contact_phone),
      contact_email  = COALESCE(EXCLUDED.contact_email, leads.contact_email),
      last_seen_at   = GREATEST(leads.last_seen_at, EXCLUDED.last_seen_at)
    RETURNING id INTO _lead_id;
  ELSE
    -- unassociated — 회사명으로 lookup, 없으면 standalone lead 생성
    IF _company IS NOT NULL THEN
      SELECT id INTO _lead_id FROM leads
       WHERE company_name = _company AND crm_id = _crm
       LIMIT 1;
    END IF;
    IF _lead_id IS NULL THEN
      INSERT INTO leads (
        crm_id, entity_id, region, version, sensor_count, voice_count,
        segment, contact_name, contact_phone, contact_email, company_name,
        last_seen_at
      ) VALUES (
        _crm, NULL, COALESCE(_r.region,'ru'), COALESCE(_r.version,'v1'), 0, 1,
        _r.segment, _r.contact_name, _r.contact_phone, _r.contact_email, _company,
        _r.captured_at
      )
      RETURNING id INTO _lead_id;
    ELSE
      UPDATE leads
         SET voice_count = voice_count + 1,
             segment = COALESCE(_r.segment, leads.segment),
             last_seen_at = GREATEST(last_seen_at, _r.captured_at)
       WHERE id = _lead_id;
    END IF;
  END IF;

  INSERT INTO lead_links (lead_id, source_table, source_id)
  VALUES (_lead_id, 'responses', _r.id)
  ON CONFLICT (source_table, source_id) DO NOTHING;

  UPDATE responses SET lead_id = _lead_id WHERE id = _r.id;

  PERFORM score_lead(_lead_id);
  PERFORM generate_dealer_output(_lead_id);

  RETURN _lead_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 트리거 1 — entity_clusters.status='normalized' 변경 시 upsert_lead_from_cluster
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_cluster_to_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'normalized'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    PERFORM upsert_lead_from_cluster(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clusters_lead ON entity_clusters;
CREATE TRIGGER trg_clusters_lead
  AFTER INSERT OR UPDATE OF status ON entity_clusters
  FOR EACH ROW EXECUTE FUNCTION trg_cluster_to_lead();

-- ----------------------------------------------------------------------------
-- 트리거 2 — responses INSERT 시 upsert_lead_from_response
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_response_to_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM upsert_lead_from_response(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_responses_lead ON responses;
CREATE TRIGGER trg_responses_lead
  AFTER INSERT ON responses
  FOR EACH ROW EXECUTE FUNCTION trg_response_to_lead();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_service ON leads
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY leads_admin_read ON leads
  FOR SELECT TO public USING (is_hd_admin());

CREATE POLICY links_service ON lead_links
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY links_admin_read ON lead_links
  FOR SELECT TO public USING (is_hd_admin());

CREATE POLICY outputs_service ON dealer_outputs
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY outputs_admin_read ON dealer_outputs
  FOR SELECT TO public USING (is_hd_admin());
