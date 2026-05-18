-- ============================================================================
-- 011_test_runs.sql
-- T_Test 측정 결과 누적 — 가설별 정량 통과 판정 입력.
-- - test_runs:       한 번의 E2E 실행 (T_04·T_05·T_06)
-- - test_assertions: 실행 안 개별 검증 항목
-- T_08 통과 판정 표가 test_runs + test_assertions를 SELECT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS test_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,

  -- 식별
  suite           TEXT NOT NULL,                  -- 'T_04' | 'T_05' | 'T_06'
  scenario        TEXT NOT NULL,                  -- 'sensor_full' 등
  actor           TEXT NOT NULL,                  -- 위버 이메일
  env             TEXT NOT NULL DEFAULT 'dev',    -- 'dev'|'staging'|'prod'

  -- 결과 요약
  status          TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'passed', 'failed', 'aborted')),
  passed_count    INT NOT NULL DEFAULT 0,
  failed_count    INT NOT NULL DEFAULT 0,
  skipped_count   INT NOT NULL DEFAULT 0,
  duration_ms     INT,

  -- 관찰 메타
  fixture_seed    TEXT,                           -- 픽스처 시드 (재현성)
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_suite_started
  ON test_runs (suite, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status
  ON test_runs (status, started_at DESC);

COMMENT ON TABLE test_runs IS
  'E2E 실행 한 건. T_08 통과 판정 표가 이 테이블 + test_assertions JOIN.';

-- ----------------------------------------------------------------------------
-- test_assertions — 한 run 안의 개별 검증 항목
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_assertions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  seq           INT  NOT NULL,                    -- run 안에서 0,1,2,...
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  step          TEXT NOT NULL,                    -- 'chunks_post' 등
  name          TEXT NOT NULL,                    -- 'capture_chunks responds 200'
  hypothesis    TEXT,                             -- 'H1'·'H3'·'V_가설'·'H_LLM'·...
  status        TEXT NOT NULL CHECK (status IN ('pass','fail','skip')),

  expected      JSONB,
  actual        JSONB,
  metric_name   TEXT,                             -- 'success_rate'·'p95_ms'·'count'
  metric_value  NUMERIC,
  duration_ms   INT,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_assertions_run
  ON test_assertions (run_id, seq);
CREATE INDEX IF NOT EXISTS idx_assertions_hypothesis
  ON test_assertions (hypothesis, status);

COMMENT ON TABLE test_assertions IS
  '실행 안의 개별 검증 단위. hypothesis로 T_02·T_03·H_*도 누적 가능.';

-- ----------------------------------------------------------------------------
-- finish_test_run — 결과 요약을 한 트랜잭션으로 잠금.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finish_test_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  _pass INT; _fail INT; _skip INT; _started TIMESTAMPTZ;
BEGIN
  SELECT
    count(*) FILTER (WHERE status = 'pass'),
    count(*) FILTER (WHERE status = 'fail'),
    count(*) FILTER (WHERE status = 'skip')
    INTO _pass, _fail, _skip
    FROM test_assertions
   WHERE run_id = p_run_id;

  SELECT started_at INTO _started FROM test_runs WHERE id = p_run_id;

  UPDATE test_runs
     SET completed_at = now(),
         passed_count = _pass,
         failed_count = _fail,
         skipped_count = _skip,
         duration_ms = (EXTRACT(EPOCH FROM (now() - _started)) * 1000)::INT,
         status = CASE WHEN _fail > 0 THEN 'failed' ELSE 'passed' END
   WHERE id = p_run_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE test_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_assertions  ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_runs_service ON test_runs
  FOR ALL TO public USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY test_runs_admin_read ON test_runs
  FOR SELECT TO public USING (is_hd_admin());

CREATE POLICY test_assertions_service ON test_assertions
  FOR ALL TO public USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY test_assertions_admin_read ON test_assertions
  FOR SELECT TO public USING (is_hd_admin());
