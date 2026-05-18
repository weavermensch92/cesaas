-- 013_llm_observability.sql
-- Anthropic API 키 (Vault 저장) + 호출당 사용 로그 + 모델 단가 테이블.
-- 어드민이 SQL/UI로 키 회전·단가 조정 가능 → env redeploy 없이 운영.

-- ----------------------------------------------------------------------------
-- 1. Vault 활성화 (이미 활성화돼 있으면 no-op)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- ----------------------------------------------------------------------------
-- 2. 모델 단가표 ($/Million Tokens) — Anthropic 가격 변경 시 SQL 한 줄로 UPDATE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_model_rates (
  model                       TEXT PRIMARY KEY,
  input_usd_per_mtok          NUMERIC(10,4) NOT NULL,
  output_usd_per_mtok         NUMERIC(10,4) NOT NULL,
  cache_read_usd_per_mtok     NUMERIC(10,4) NOT NULL DEFAULT 0,
  cache_creation_usd_per_mtok NUMERIC(10,4) NOT NULL DEFAULT 0,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_llm_rates_updated BEFORE UPDATE ON llm_model_rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 시드 (2026-05 시점, 어드민이 SQL로 갱신)
INSERT INTO llm_model_rates (model, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_creation_usd_per_mtok)
VALUES
  ('claude-opus-4-7',     15.0000, 75.0000,  1.5000, 18.7500),
  ('claude-sonnet-4-6',    3.0000, 15.0000,  0.3000,  3.7500),
  ('claude-haiku-4-5',     1.0000,  5.0000,  0.1000,  1.2500)
ON CONFLICT (model) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. 호출당 사용 로그
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_usage (
  id                       BIGSERIAL PRIMARY KEY,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  function_name            TEXT NOT NULL,
  model                    TEXT NOT NULL,
  rule_id                  TEXT,
  prompt_key               TEXT,
  request_id               TEXT,
  input_tokens             INTEGER NOT NULL DEFAULT 0,
  output_tokens            INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens        INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens    INTEGER NOT NULL DEFAULT 0,
  est_cost_usd             NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms               INTEGER,
  error                    TEXT
);
CREATE INDEX llm_usage_created_idx   ON llm_usage(created_at DESC);
CREATE INDEX llm_usage_function_idx  ON llm_usage(function_name, created_at DESC);

COMMENT ON TABLE llm_usage IS 'Anthropic 호출당 1행 — 모델·토큰·비용 추적. shared/llm.ts가 record_llm_usage()로 INSERT.';

-- ----------------------------------------------------------------------------
-- 4. API 키 관리 (Vault wrapper RPCs)
--    service_role 전용. 어드민 Edge Function (admin-settings) 만 호출.
-- ----------------------------------------------------------------------------

-- 키 설정 (회전)
CREATE OR REPLACE FUNCTION set_anthropic_api_key(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_key IS NULL OR length(p_key) < 10 THEN
    RAISE EXCEPTION 'invalid key length' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'anthropic_api_key';
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, p_key);
  ELSE
    PERFORM vault.create_secret(p_key, 'anthropic_api_key', 'Anthropic API key (rotated via admin)');
  END IF;
END;
$$;

-- 키 조회 (Edge Function이 호출 직전 사용)
CREATE OR REPLACE FUNCTION get_anthropic_api_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'anthropic_api_key'
  LIMIT 1;
  RETURN v_key;
END;
$$;

-- 키 메타 (어드민 표시용 — 키 평문 노출 X)
CREATE OR REPLACE FUNCTION get_anthropic_api_key_meta()
RETURNS TABLE(present BOOLEAN, updated_at TIMESTAMPTZ, last_4 TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM vault.secrets WHERE name = 'anthropic_api_key';
  IF v_count = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    TRUE,
    s.updated_at,
    RIGHT(ds.decrypted_secret, 4)
  FROM vault.secrets s
  JOIN vault.decrypted_secrets ds ON ds.id = s.id
  WHERE s.name = 'anthropic_api_key'
  LIMIT 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. 사용 로그 INSERT (자동 비용 계산)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_llm_usage(
  p_function_name         TEXT,
  p_model                 TEXT,
  p_input_tokens          INTEGER,
  p_output_tokens         INTEGER,
  p_cache_read_tokens     INTEGER DEFAULT 0,
  p_cache_creation_tokens INTEGER DEFAULT 0,
  p_rule_id               TEXT DEFAULT NULL,
  p_prompt_key            TEXT DEFAULT NULL,
  p_request_id            TEXT DEFAULT NULL,
  p_latency_ms            INTEGER DEFAULT NULL,
  p_error                 TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            llm_model_rates%ROWTYPE;
  v_cost       NUMERIC(12,6);
  v_id         BIGINT;
BEGIN
  SELECT * INTO r FROM llm_model_rates WHERE model = p_model;
  IF NOT FOUND THEN
    v_cost := 0;
  ELSE
    v_cost := (COALESCE(p_input_tokens, 0)          * r.input_usd_per_mtok
            +  COALESCE(p_output_tokens, 0)         * r.output_usd_per_mtok
            +  COALESCE(p_cache_read_tokens, 0)     * r.cache_read_usd_per_mtok
            +  COALESCE(p_cache_creation_tokens, 0) * r.cache_creation_usd_per_mtok
            ) / 1000000.0;
  END IF;
  INSERT INTO llm_usage(
    function_name, model, rule_id, prompt_key, request_id,
    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    est_cost_usd, latency_ms, error
  ) VALUES (
    p_function_name, p_model, p_rule_id, p_prompt_key, p_request_id,
    COALESCE(p_input_tokens, 0), COALESCE(p_output_tokens, 0),
    COALESCE(p_cache_read_tokens, 0), COALESCE(p_cache_creation_tokens, 0),
    v_cost, p_latency_ms, p_error
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. 어드민 집계 (days 단위)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_llm_usage_summary(p_days INTEGER DEFAULT 7)
RETURNS TABLE(
  day                    DATE,
  function_name          TEXT,
  model                  TEXT,
  calls                  BIGINT,
  input_tokens           BIGINT,
  output_tokens          BIGINT,
  cache_read_tokens      BIGINT,
  cache_creation_tokens  BIGINT,
  total_cost_usd         NUMERIC,
  errors                 BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::DATE AS day,
    function_name,
    model,
    COUNT(*)::BIGINT,
    SUM(input_tokens)::BIGINT,
    SUM(output_tokens)::BIGINT,
    SUM(cache_read_tokens)::BIGINT,
    SUM(cache_creation_tokens)::BIGINT,
    SUM(est_cost_usd),
    COUNT(*) FILTER (WHERE error IS NOT NULL)::BIGINT
  FROM llm_usage
  WHERE created_at > now() - (GREATEST(p_days, 1) || ' days')::INTERVAL
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 9 DESC NULLS LAST;
$$;

-- ----------------------------------------------------------------------------
-- 7. RLS · GRANT
-- ----------------------------------------------------------------------------
ALTER TABLE llm_usage       ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_model_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY llm_usage_admin_read   ON llm_usage       FOR SELECT TO authenticated USING (is_hd_admin());
CREATE POLICY llm_usage_service      ON llm_usage       FOR ALL    TO service_role  USING (true) WITH CHECK (true);
CREATE POLICY llm_rates_admin_read   ON llm_model_rates FOR SELECT TO authenticated USING (is_hd_admin());
CREATE POLICY llm_rates_service      ON llm_model_rates FOR ALL    TO service_role  USING (true) WITH CHECK (true);

-- service_role 만 키 RPC 호출 가능 (어드민 Edge Function 내부에서 service_role 클라이언트로 실행)
REVOKE ALL ON FUNCTION set_anthropic_api_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_anthropic_api_key()     FROM PUBLIC;
REVOKE ALL ON FUNCTION get_anthropic_api_key_meta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_anthropic_api_key(TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION get_anthropic_api_key()      TO service_role;
GRANT EXECUTE ON FUNCTION get_anthropic_api_key_meta() TO service_role;
GRANT EXECUTE ON FUNCTION record_llm_usage(TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_llm_usage_summary(INTEGER) TO service_role;
