-- ============================================================================
-- 002_sensor.sql
-- S_Sensor 채널 — captures · crm_definitions · entity_clusters · normalized_fields.
-- S_40_Data 전 6 문서 (S_40.01 ~ S_40.06) 기반.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sensor_api_keys — Extension HMAC + API key 발급 레지스트리.
-- C_04_인증.md § 2. hmac.ts loadKey가 이 테이블 조회.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_api_keys (
  key_id      TEXT PRIMARY KEY,
  secret      TEXT NOT NULL,             -- 32 bytes hex 권장 (Supabase Secret로 별도 보관 가능)
  dealer_id   TEXT,                       -- NULL = 글로벌 키
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '365 days')
);

COMMENT ON TABLE sensor_api_keys
  IS 'Extension용 HMAC 키 레지스트리. 1년 만료, dealer_id 단위 또는 글로벌.';

ALTER TABLE sensor_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY sensor_api_keys_service ON sensor_api_keys
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- crm_definitions — CRM-agnostic 매트릭스 (S_40.02).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_definitions (
  id              TEXT PRIMARY KEY,       -- 'bitrix24' 등
  name            TEXT NOT NULL,
  description     TEXT,
  host_pattern    TEXT NOT NULL,          -- regex string
  screen_patterns JSONB NOT NULL,         -- [{screen,url_regex,entity_extract_group}]
  version         INT  NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'beta', 'deprecated')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_crm_definitions_updated_at
  BEFORE UPDATE ON crm_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- v1 시드 — Bitrix24
INSERT INTO crm_definitions (id, name, host_pattern, screen_patterns)
VALUES (
  'bitrix24',
  'Bitrix24',
  '^https://(bitrix\.gkcompany\.pro|[^/]+\.bitrix24\.(com|ru))/',
  '[
    {"screen": "deal_list",   "url_regex": "^/crm/deal/?(\\?.*)?$"},
    {"screen": "deal_detail", "url_regex": "^/crm/deal/details/(\\d+)/?$", "entity_extract_group": 1},
    {"screen": "company",     "url_regex": "^/crm/company/details/(\\d+)/?$", "entity_extract_group": 1},
    {"screen": "contact",     "url_regex": "^/crm/contact/details/(\\d+)/?$", "entity_extract_group": 1},
    {"screen": "activity",    "url_regex": "^/crm/activity/.*"},
    {"screen": "funnel",      "url_regex": "^/crm/deal/funnel/.*"},
    {"screen": "task",        "url_regex": "^/crm/task/.*"}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE crm_definitions ENABLE ROW LEVEL SECURITY;

-- Admin·anon 모두 read (Extension v2가 fetch); write는 service_role.
CREATE POLICY crm_definitions_read ON crm_definitions
  FOR SELECT TO public USING (true);
CREATE POLICY crm_definitions_write ON crm_definitions
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- captures — Extension 송출 결과 (S_40.01).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captures (
  -- 공통 컬럼 (C_02_DB.md § 2)
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 식별·라우팅
  crm_id      TEXT NOT NULL REFERENCES crm_definitions(id),
  region      TEXT NOT NULL DEFAULT 'ru',
  version     TEXT NOT NULL DEFAULT 'v1',

  -- 통합 연결 (leads는 004_unified에서 생성 — FK는 deferred ALTER)
  lead_id     UUID,
  entity_id   TEXT,

  -- 발신자
  dealer_id   TEXT NOT NULL,
  source      source_t NOT NULL DEFAULT 'extension',
  direction   direction_t NOT NULL DEFAULT 'upward',

  -- URL·페이지 메타
  url            TEXT NOT NULL,
  url_path       TEXT NOT NULL,
  title          TEXT,
  referrer       TEXT,
  spa_enter_time NUMERIC,                  -- ms (performance.now)

  -- viewport
  viewport_width  INT,
  viewport_height INT,
  viewport_dpr    REAL,

  -- 캡쳐
  captured_at      TIMESTAMPTZ NOT NULL,
  image_path       TEXT,                   -- Storage path captures/yyyy-mm/{id}.webp
  image_size_bytes INT,
  image_format     TEXT NOT NULL DEFAULT 'image/webp',
  thumbnail_path   TEXT,

  -- 분류 결과 (S_20.02)
  screen_type               TEXT,          -- 'deal_detail' 등
  classification_confidence REAL,
  classification_method     TEXT,          -- 'url_regex' | 'llm'
  classified_at             TIMESTAMPTZ,

  -- 청크 송출 메타 (S_10.04 · S_20.01)
  total_chunks   INT,
  finalized_at   TIMESTAMPTZ,
  finalize_hash  TEXT,

  -- 상태
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'finalized', 'classified', 'clustered', 'failed'))
);

CREATE TRIGGER trg_captures_updated_at
  BEFORE UPDATE ON captures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 인덱스 (S_40.06)
CREATE INDEX IF NOT EXISTS idx_captures_created_at ON captures (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_dealer     ON captures (dealer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_entity     ON captures (entity_id, crm_id)
  WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_captures_status     ON captures (status);
CREATE INDEX IF NOT EXISTS idx_captures_lead       ON captures (lead_id)
  WHERE lead_id IS NOT NULL;

COMMENT ON TABLE captures IS 'Extension 송출 캡쳐 + 메타 + Storage 경로 + 분류 결과.';

-- ----------------------------------------------------------------------------
-- capture_chunks — 청크 송출 중간 저장 (finalize 시 합성).
-- S_20.01 § 3.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capture_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id  UUID NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  chunk_index INT  NOT NULL,
  total_chunks INT NOT NULL,
  bytes       BYTEA NOT NULL,
  chunk_hash  TEXT  NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (capture_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_capture ON capture_chunks (capture_id, chunk_index);

ALTER TABLE capture_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY capture_chunks_service ON capture_chunks
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- entity_clusters — 같은 entity 묶음 (S_40.03).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_clusters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  entity_id   TEXT NOT NULL,
  crm_id      TEXT NOT NULL REFERENCES crm_definitions(id),

  capture_ids UUID[] NOT NULL DEFAULT '{}',
  image_count INT    NOT NULL DEFAULT 0,

  status      normalize_status_t NOT NULL DEFAULT 'pending_normalize',
  -- normalized_fields_id는 normalized_fields 테이블 생성 후 ALTER로 추가.
  normalized_at TIMESTAMPTZ,

  lead_id     UUID,
  region      TEXT NOT NULL DEFAULT 'ru',
  version     TEXT NOT NULL DEFAULT 'v1',

  UNIQUE (entity_id, crm_id)
);

CREATE TRIGGER trg_clusters_updated_at
  BEFORE UPDATE ON entity_clusters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_clusters_pending ON entity_clusters (status, updated_at)
  WHERE status = 'pending_normalize';
CREATE INDEX IF NOT EXISTS idx_clusters_entity  ON entity_clusters (entity_id, crm_id);
CREATE INDEX IF NOT EXISTS idx_clusters_lead    ON entity_clusters (lead_id)
  WHERE lead_id IS NOT NULL;

COMMENT ON TABLE entity_clusters IS '같은 entity_id의 캡쳐 묶음. 정규화 단위.';

-- ----------------------------------------------------------------------------
-- normalized_fields — Claude Vision 13 필드 추출 결과 (S_40.04).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS normalized_fields (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  cluster_id  UUID NOT NULL REFERENCES entity_clusters(id) ON DELETE CASCADE,
  entity_id   TEXT NOT NULL,
  crm_id      TEXT NOT NULL,

  -- 13 필드 (개별 컬럼 + confidence)
  deal_id                       TEXT,
  deal_id_confidence            REAL,
  deal_code                     TEXT,
  deal_code_confidence          REAL,
  company_name                  TEXT,
  company_name_confidence       REAL,
  contact_name                  TEXT,
  contact_name_confidence       REAL,
  contact_phone                 TEXT,
  contact_phone_confidence      REAL,
  contact_email                 TEXT,
  contact_email_confidence      REAL,
  amount                        NUMERIC,
  currency                      TEXT,
  amount_confidence             REAL,
  stage                         TEXT,
  stage_confidence              REAL,
  product_model                 TEXT,
  product_model_confidence      REAL,
  region                        TEXT,
  region_confidence             REAL,
  date_created                  TIMESTAMPTZ,
  date_created_confidence       REAL,
  responsible_dealer            TEXT,
  responsible_dealer_confidence REAL,

  -- 메타
  model           TEXT NOT NULL,           -- 'claude-opus-4-7'
  prompt_version  TEXT NOT NULL,           -- R_10.06 yaml version

  -- 라이프사이클
  status         TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'rejected')),
  superseded_at  TIMESTAMPTZ,
  edited_by      TEXT,
  edited_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_norm_active ON normalized_fields (cluster_id, status)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_norm_entity ON normalized_fields (entity_id, crm_id);
CREATE INDEX IF NOT EXISTS idx_norm_prompt ON normalized_fields (prompt_version, status);

COMMENT ON TABLE normalized_fields IS 'LLM 13 필드 추출 결과. 클러스터당 active 1개.';

-- ----------------------------------------------------------------------------
-- 양방향 FK — entity_clusters.normalized_fields_id (S_40.03)
-- ----------------------------------------------------------------------------
ALTER TABLE entity_clusters
  ADD COLUMN IF NOT EXISTS normalized_fields_id UUID
    REFERENCES normalized_fields(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- normalize_audit — Admin 수동 편집 이력 (S_50.03).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS normalize_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  normalized_id UUID NOT NULL REFERENCES normalized_fields(id) ON DELETE CASCADE,
  cluster_id    UUID NOT NULL REFERENCES entity_clusters(id)   ON DELETE CASCADE,
  field         TEXT NOT NULL,
  before_value  TEXT,
  after_value   TEXT,
  edited_by     TEXT NOT NULL,
  edit_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_normalized
  ON normalize_audit (normalized_id, created_at DESC);

COMMENT ON TABLE normalize_audit IS '13 필드 편집 이력 — 누가·언제·무엇.';

-- ----------------------------------------------------------------------------
-- Storage 버킷 등록 (캡쳐 WebP)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('captures', 'captures', false, 1048576, ARRAY['image/webp', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE captures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_clusters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_fields  ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalize_audit    ENABLE ROW LEVEL SECURITY;

-- service_role 모든 권한
CREATE POLICY captures_service          ON captures
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY clusters_service          ON entity_clusters
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY normalized_service        ON normalized_fields
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY audit_service             ON normalize_audit
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Admin read (hd_admin / gridge_admin)
CREATE POLICY captures_admin_read       ON captures
  FOR SELECT TO public USING (is_hd_admin());
CREATE POLICY clusters_admin_read       ON entity_clusters
  FOR SELECT TO public USING (is_hd_admin());
CREATE POLICY normalized_admin_read     ON normalized_fields
  FOR SELECT TO public USING (is_hd_admin());
CREATE POLICY audit_admin_read          ON normalize_audit
  FOR SELECT TO public USING (is_hd_admin());

-- Admin 편집 — normalized_fields UPDATE만 (audit은 trigger·앱이 INSERT)
CREATE POLICY normalized_admin_update   ON normalized_fields
  FOR UPDATE TO public
  USING (is_hd_admin())
  WITH CHECK (is_hd_admin());
CREATE POLICY audit_admin_insert        ON normalize_audit
  FOR INSERT TO public WITH CHECK (is_hd_admin());

-- ----------------------------------------------------------------------------
-- 30일 자동 삭제 cron (운영 시 등록 — captures 행 + storage 객체)
-- ----------------------------------------------------------------------------
-- 운영 환경에서만 실행:
--   SELECT cron.schedule('delete_old_captures', '0 3 * * *', $$
--     DELETE FROM captures WHERE created_at < now() - interval '30 days';
--     DELETE FROM storage.objects WHERE bucket_id = 'captures'
--       AND created_at < now() - interval '30 days';
--   $$);
