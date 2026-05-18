-- ============================================================================
-- 005_runtime.sql
-- 하네스 2 (Runtime) — R_10 룰 버전 관리.
-- 위버가 hot reload로 INSERT 새 row + 이전 row archived. 워커는 status='active'만 사용.
-- R_10 YAML 원본(seed)은 C_Common/r_10_rules/. 운영 변경은 이 테이블에서.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rule_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     TEXT NOT NULL,                   -- 'R_10.06_PromptTemplates' 등
  version     TEXT NOT NULL,                   -- semver-like or YAML version
  body_yaml   TEXT NOT NULL,                   -- 룰 YAML 원문
  body_json   JSONB,                           -- 파싱본 (캐시 — optional, NULL 허용)
  status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'draft')),
  notes       TEXT,
  edited_by   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- rule_id별 active 1개만 — partial UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS uq_rule_versions_active
  ON rule_versions (rule_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_rule_versions_rule_status
  ON rule_versions (rule_id, status, created_at DESC);

COMMENT ON TABLE rule_versions IS
  '하네스 2 R_10 룰 버전 관리. status=active 1개·archived 보존(rollback). 변경 = 새 row + 이전 archive.';

-- ----------------------------------------------------------------------------
-- rule_audit — 누가 언제 무엇을 (v2 본격, v1 단순 기록)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rule_version_id UUID NOT NULL REFERENCES rule_versions(id) ON DELETE CASCADE,
  rule_id         TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('publish', 'archive', 'rollback')),
  actor           TEXT NOT NULL,                -- 위버 user id 또는 시스템
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_rule_audit_rule
  ON rule_audit (rule_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- publish_rule — 새 룰을 active로 만들고 이전 active를 archive로 (트랜잭션)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_rule(
  p_rule_id   TEXT,
  p_version   TEXT,
  p_body_yaml TEXT,
  p_body_json JSONB,
  p_actor     TEXT,
  p_notes     TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _new_id UUID;
BEGIN
  -- 1) 기존 active를 archived로
  UPDATE rule_versions
     SET status = 'archived', archived_at = now()
   WHERE rule_id = p_rule_id AND status = 'active';

  -- 2) 새 active INSERT
  INSERT INTO rule_versions (rule_id, version, body_yaml, body_json, status, edited_by, notes)
  VALUES (p_rule_id, p_version, p_body_yaml, p_body_json, 'active', p_actor, p_notes)
  RETURNING id INTO _new_id;

  -- 3) audit
  INSERT INTO rule_audit (rule_version_id, rule_id, action, actor, reason)
  VALUES (_new_id, p_rule_id, 'publish', p_actor, p_notes);

  RETURN _new_id;
END;
$$;

COMMENT ON FUNCTION publish_rule(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  IS '룰 정정 — 이전 active archive + 새 active INSERT + audit. 트랜잭션 안전.';

-- ----------------------------------------------------------------------------
-- RLS — service_role 전권 / hd_admin·gridge_admin read / 위버 R_20만 write
-- ----------------------------------------------------------------------------
ALTER TABLE rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_audit    ENABLE ROW LEVEL SECURITY;

CREATE POLICY rule_versions_service ON rule_versions
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY rule_versions_admin_read ON rule_versions
  FOR SELECT TO public USING (is_hd_admin());

CREATE POLICY rule_audit_service ON rule_audit
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY rule_audit_admin_read ON rule_audit
  FOR SELECT TO public USING (is_hd_admin());

-- ----------------------------------------------------------------------------
-- 초기 시드 — R_10.06 PromptTemplates (sensor_13_fields 등).
-- C_Common/r_10_rules/R_10.06_PromptTemplates.yaml 의 v2026-05-18.002 스냅샷.
-- 운영 시 publish_rule()로 정정.
-- ----------------------------------------------------------------------------
INSERT INTO rule_versions (rule_id, version, body_yaml, status, edited_by, notes)
VALUES (
  'R_10.06_PromptTemplates',
  '2026-05-18.002',
  E'version: 0.1\n'
  || E'updated_at: ''2026-05-18''\n\n'
  || E'sensor_13_fields:\n'
  || E'  version: ''2026-05-18.002''\n'
  || E'  max_tokens: 2000\n'
  || E'  system: |\n'
  || E'    당신은 HD건설기계의 러시아 영업 깔때기 데이터 추출 어시스턴트이다.\n'
  || E'    Bitrix24 CRM 스크린샷 1~5장을 받아 동일 deal의 13개 표준 필드를 JSON으로 반환한다.\n'
  || E'    모르는 값은 null. 추측 금지. 회사명·연락처에서 추론한 가치 판단도 금지.\n'
  || E'    출력은 반드시 valid JSON 한 덩어리. 설명 텍스트·markdown fence 금지.\n'
  || E'    각 필드에 confidence(0.0~1.0)도 동시에 산출 — 시각 인식 신뢰도이지 사실 확신도가 아님.\n'
  || E'  user: |\n'
  || E'    아래 1~5장의 스크린샷은 동일한 deal entity의 여러 화면이다.\n'
  || E'    아래 schema 에 맞춰 정확히 키 13개 + confidence 객체로 JSON 작성.\n'
  || E'    schema:\n'
  || E'      {\n'
  || E'        "deal_id":            string | null,\n'
  || E'        "deal_code":          string | null,\n'
  || E'        "company_name":       string | null,\n'
  || E'        "contact_name":       string | null,\n'
  || E'        "contact_phone":      string | null,\n'
  || E'        "contact_email":      string | null,\n'
  || E'        "amount":             number | null,\n'
  || E'        "currency":           string | null,\n'
  || E'        "stage":              string | null,\n'
  || E'        "product_model":      string | null,\n'
  || E'        "region":             string | null,\n'
  || E'        "date_created":       string | null,\n'
  || E'        "responsible_dealer": string | null,\n'
  || E'        "confidence": {\n'
  || E'          "deal_id":            0.0~1.0,\n'
  || E'          "deal_code":          0.0~1.0,\n'
  || E'          "company_name":       0.0~1.0,\n'
  || E'          "contact_name":       0.0~1.0,\n'
  || E'          "contact_phone":      0.0~1.0,\n'
  || E'          "contact_email":      0.0~1.0,\n'
  || E'          "amount":             0.0~1.0,\n'
  || E'          "stage":              0.0~1.0,\n'
  || E'          "product_model":      0.0~1.0,\n'
  || E'          "region":             0.0~1.0,\n'
  || E'          "date_created":       0.0~1.0,\n'
  || E'          "responsible_dealer": 0.0~1.0\n'
  || E'        }\n'
  || E'      }\n',
  'active',
  'system_seed',
  'initial seed from C_Common/r_10_rules/R_10.06_PromptTemplates.yaml'
)
ON CONFLICT DO NOTHING;
