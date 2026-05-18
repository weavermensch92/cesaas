-- ============================================================================
-- 006_idempotency.sql
-- Idempotency-Key 처리 + HMAC nonce 캐시.
-- C_03_API_패턴.md § 4 · C_04_인증.md § 2.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- processed_events: Idempotency-Key 저장 (24h TTL)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_events (
  idempotency_key   TEXT PRIMARY KEY,
  route             TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  response_status   INT  NOT NULL,
  response_body     JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_processed_events_expires
  ON processed_events (expires_at);

COMMENT ON TABLE processed_events
  IS '클라이언트 Idempotency-Key 별 응답 캐시. 24h TTL.';

-- ----------------------------------------------------------------------------
-- hmac_nonces: HMAC 인증 nonce 중복 차단 (5분 TTL)
-- C_04_인증.md § 2.검증
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hmac_nonces (
  key_id     TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  PRIMARY KEY (key_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_hmac_nonces_expires
  ON hmac_nonces (expires_at);

COMMENT ON TABLE hmac_nonces
  IS 'HMAC 인증 중 nonce 1회용 보장. 5분 TTL.';

-- ----------------------------------------------------------------------------
-- 만료 청소 함수 (pg_cron으로 5분마다 등록 예정)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_idempotency_expired()
RETURNS INT AS $$
DECLARE
  deleted_count INT := 0;
  tmp INT;
BEGIN
  DELETE FROM processed_events WHERE expires_at < now();
  GET DIAGNOSTICS tmp = ROW_COUNT;
  deleted_count := deleted_count + tmp;

  DELETE FROM hmac_nonces WHERE expires_at < now();
  GET DIAGNOSTICS tmp = ROW_COUNT;
  deleted_count := deleted_count + tmp;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_idempotency_expired()
  IS '만료된 idempotency 키·HMAC nonce 삭제. cron 등록 (운영).';

-- 운영 등록 예시:
--   SELECT cron.schedule('cleanup_idempotency', '*/5 * * * *',
--     'SELECT cleanup_idempotency_expired();'
--   );

-- ----------------------------------------------------------------------------
-- RLS: service_role만 접근
-- ----------------------------------------------------------------------------
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hmac_nonces      ENABLE ROW LEVEL SECURITY;

CREATE POLICY processed_events_service_only ON processed_events
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY hmac_nonces_service_only ON hmac_nonces
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
