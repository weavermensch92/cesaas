-- 026_dealers.sql
-- 통합 딜러 레지스트리. /dealers 어드민 페이지에서 한 폼으로 등록.
-- 향후 affiliation (소속회사) 은 별도 dealer_companies 테이블로 분할 예정.
-- 현 시점: 어드민이 텍스트로 입력. 딜러 관리자/하위 딜러 구분도 추후.

CREATE TABLE IF NOT EXISTS dealers (
  dealer_id      TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  affiliation    TEXT,                            -- 소속회사 (자유 텍스트, 향후 FK 분할)
  region         TEXT,                            -- 'ru' / 'kr' / 'global'
  event          TEXT,                            -- 'ctt_moscow_2026'
  contact_email  TEXT,
  contact_phone  TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT,                            -- admin email
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS dealers_affiliation_idx ON dealers(affiliation);
CREATE INDEX IF NOT EXISTS dealers_region_event_idx ON dealers(region, event);

CREATE TRIGGER trg_dealers_updated BEFORE UPDATE ON dealers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE dealers IS
  '통합 딜러 레지스트리. /dealers 어드민에서 Voice JWT + Sensor 키 일괄 발급의 기준 row. affiliation 은 텍스트 — 향후 dealer_companies 분할 예정.';

ALTER TABLE dealers ENABLE ROW LEVEL SECURITY;
CREATE POLICY dealers_service ON dealers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY dealers_admin_read ON dealers FOR SELECT TO authenticated USING (is_hd_admin());
