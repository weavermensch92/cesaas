-- ============================================================================
-- 001_common.sql
-- 공통 ENUM · 유틸리티 함수 · base 트리거.
-- C_02_DB.md § 2 (공통 컬럼) · C_07_보안_법무.md (30일 보관).
-- ============================================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- ----------------------------------------------------------------------------
-- ENUM 정의 (모든 모듈 공유)
-- ----------------------------------------------------------------------------

-- direction: serves 표준에 따라 upward(딜러→본사) / downward(본사→딜러)
DO $$ BEGIN
  CREATE TYPE direction_t AS ENUM ('upward', 'downward');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- source: 데이터 출처 채널
DO $$ BEGIN
  CREATE TYPE source_t AS ENUM ('extension', 'dealer', 'visitor', 'admin', 'worker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- capture/normalize status
DO $$ BEGIN
  CREATE TYPE normalize_status_t AS ENUM (
    'pending_normalize',
    'normalizing',
    'normalized',
    'failed',
    'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 유틸 함수 — updated_at 자동 갱신
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 유틸 함수 — JWT role 추출 (RLS에서 사용)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_role()
RETURNS TEXT AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', auth.role()::text);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_hd_admin()
RETURNS BOOLEAN AS $$
  SELECT auth_role() IN ('hd_admin', 'gridge_admin', 'service_role');
$$ LANGUAGE sql STABLE;

-- ----------------------------------------------------------------------------
-- 30일 자동 삭제 — Storage 객체 (captures 버킷)
-- C_02_DB.md § 3
-- ----------------------------------------------------------------------------
-- NOTE: pg_cron 활성화 후 supabase 운영 환경에서만 실 스케줄 등록.
-- 로컬 dev 환경에서는 별도 시드 X.
-- 등록 예시 (운영):
--   SELECT cron.schedule('delete_old_captures', '0 3 * * *', $$
--     DELETE FROM storage.objects
--     WHERE bucket_id = 'captures' AND created_at < now() - interval '30 days';
--   $$);

COMMENT ON FUNCTION set_updated_at()
  IS 'BEFORE UPDATE 트리거에 부착 — updated_at 자동 now() 처리.';
COMMENT ON FUNCTION auth_role()
  IS 'JWT의 role 클레임 (없으면 auth.role()) 반환. RLS 정책에서 사용.';
COMMENT ON FUNCTION is_hd_admin()
  IS 'hd_admin·gridge_admin·service_role 여부. RLS shorthand.';
