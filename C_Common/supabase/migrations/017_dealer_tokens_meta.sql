-- ============================================================================
-- 017_dealer_tokens_meta.sql
-- voice_dealer_tokens 운영 메타 — Admin이 발급한 토큰을 식별·추적.
--
-- 추가 컬럼:
--   label      — Admin이 붙인 자유 텍스트 (예: "부스 B-3 안드레이")
--   issued_by  — 발급한 관리자 email (admin_auth.email)
--
-- 기존 row는 issued_by NULL — R_20 CLI로 발급되었음을 의미.
-- ============================================================================

ALTER TABLE voice_dealer_tokens
  ADD COLUMN IF NOT EXISTS label      TEXT,
  ADD COLUMN IF NOT EXISTS issued_by  TEXT;

CREATE INDEX IF NOT EXISTS idx_dealer_tokens_issued_at
  ON voice_dealer_tokens (issued_at DESC);
