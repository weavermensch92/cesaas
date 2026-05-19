-- 021_disable_trigger_scoring.sql
-- Phase D.3 — trigger 내부의 PERFORM score_lead / PERFORM generate_dealer_output 제거.
--
-- 이유:
--   score_lead()는 R_10.01 v0.1 weights 스냅샷을 plpgsql로 미러링한 함수. R_10.01이
--   harness1 schema(condition·action·severity)로 통일된 후 그 미러 의미와 분기됨.
--   scoring 책임을 Edge Function (V_Voice·S_Sensor shared/lead_scoring.ts)으로 이전:
--     - lib loadRule(DB rule_versions.active)로 룰 가져옴 → publish-rule.ts hot reload 작동
--     - applyLeadScoringCore + applyLeadQualityCore + classifyLeadPriorityCore
--     - UPDATE leads { score, grade, priority, score_at, score_version } + dealer_outputs INSERT
--
--   trigger는 그대로 두되, lead upsert만 담당하도록 슬림화. 호출은:
--     - V_Voice/backend/functions/responses-receive: save_response 후 scoreLead(lead_id)
--     - S_Sensor/backend/functions/normalize-worker:  save_normalized 후 scoreLead(lead_id)
--
-- score_lead() / generate_dealer_output() 자체는 보존 (rollback 안전성).
-- 트리거에서 호출이 사라지면 호출자 없는 dead-code가 되지만, 명시적 PERFORM/SELECT는 가능.

-- ----------------------------------------------------------------------------
-- upsert_lead_from_cluster — PERFORM score_lead/generate_dealer_output 제거
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_lead_from_cluster(p_cluster_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _entity TEXT; _crm TEXT; _lead_id UUID;
  _nf     normalized_fields%ROWTYPE;
BEGIN
  SELECT entity_id, crm_id INTO _entity, _crm
    FROM entity_clusters WHERE id = p_cluster_id;
  IF _entity IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _nf
    FROM normalized_fields
   WHERE cluster_id = p_cluster_id AND status = 'active'
   ORDER BY created_at DESC LIMIT 1;

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

  INSERT INTO lead_links (lead_id, source_table, source_id)
  VALUES (_lead_id, 'entity_clusters', p_cluster_id)
  ON CONFLICT (source_table, source_id) DO NOTHING;

  UPDATE entity_clusters SET lead_id = _lead_id WHERE id = p_cluster_id;
  UPDATE captures        SET lead_id = _lead_id
   WHERE entity_id = _entity AND crm_id = _crm AND lead_id IS NULL;

  -- Phase D.3 — scoring removed from trigger. normalize-worker가 Edge에서 scoreLead 호출.
  -- (이전: PERFORM score_lead(_lead_id); PERFORM generate_dealer_output(_lead_id);)

  RETURN _lead_id;
END;
$$;

COMMENT ON FUNCTION upsert_lead_from_cluster(UUID) IS
  'cluster → lead UPSERT + linkage. Phase D.3부터 scoring은 Edge Function이 담당 (shared/lead_scoring.ts).';

-- ----------------------------------------------------------------------------
-- upsert_lead_from_response — PERFORM score_lead/generate_dealer_output 제거
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

  _entity := _r.axis_data ->> 'entity_id';
  _company := _r.contact_name;

  IF _entity IS NOT NULL THEN
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

  -- Phase D.3 — scoring removed from trigger. responses-receive가 Edge에서 scoreLead 호출.
  -- (이전: PERFORM score_lead(_lead_id); PERFORM generate_dealer_output(_lead_id);)

  RETURN _lead_id;
END;
$$;

COMMENT ON FUNCTION upsert_lead_from_response(UUID) IS
  'response → lead UPSERT + linkage. Phase D.3부터 scoring은 Edge Function이 담당 (shared/lead_scoring.ts).';

-- ----------------------------------------------------------------------------
-- 기존 score_lead / generate_dealer_output 함수는 보존 (rollback 안전)
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION score_lead(UUID) IS
  '⚠️ DEPRECATED (Phase D.3). R_10.01 v0.1 weights 미러. scoring은 Edge Function의 shared/lead_scoring.ts가 담당 (R_10.01 harness1 schema + lib applyLeadScoringCore). 본 함수는 rollback 시점 비교용으로만 유지.';

COMMENT ON FUNCTION generate_dealer_output(UUID) IS
  '⚠️ DEPRECATED (Phase D.3). dealer_outputs INSERT은 shared/lead_scoring.ts가 담당. 본 함수는 rollback 시점 비교용으로만 유지.';
