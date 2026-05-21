-- 030_soft_delete_member.sql
-- 회원 소프트 삭제: user_id 보존, 이메일·개인정보 익명화, Supabase Auth ban.

-- ----------------------------------------------------------------------------
-- 1. deleted_at 컬럼
-- ----------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS user_profiles_deleted_at_idx
  ON user_profiles(deleted_at) WHERE deleted_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. list_user_profiles — deleted_at 포함 (반환 타입 변경이라 DROP + CREATE)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS list_user_profiles();

CREATE FUNCTION list_user_profiles()
RETURNS TABLE(
  user_id        UUID,
  email          TEXT,
  role           user_role,
  password_set   BOOLEAN,
  created_at     TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  invited_by_email TEXT,
  deleted_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT up.user_id, up.email, up.role, up.password_set, up.created_at, up.last_login_at,
         (SELECT email FROM user_profiles ib WHERE ib.user_id = up.invited_by) AS invited_by_email,
         up.deleted_at
  FROM user_profiles up
  ORDER BY up.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_user_profiles() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION list_user_profiles() TO service_role;

-- ----------------------------------------------------------------------------
-- 3. soft_delete_member RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_member(p_user_id UUID, p_actor UUID DEFAULT NULL)
RETURNS user_profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE r user_profiles;
BEGIN
  -- 마지막 활성 super_admin 삭제 금지
  IF (SELECT role FROM user_profiles WHERE user_id = p_user_id AND deleted_at IS NULL) = 'super_admin'
     AND (SELECT COUNT(*) FROM user_profiles WHERE role = 'super_admin' AND deleted_at IS NULL) <= 1 THEN
    RAISE EXCEPTION 'cannot delete the last super_admin' USING ERRCODE = '23514';
  END IF;

  UPDATE user_profiles
  SET email        = 'deleted-' || substr(p_user_id::text, 1, 8) || '@anon.local',
      deleted_at   = now(),
      password_set = FALSE,
      updated_at   = now()
  WHERE user_id = p_user_id AND deleted_at IS NULL
  RETURNING * INTO r;

  IF r IS NULL THEN
    RAISE EXCEPTION 'member not found or already deleted' USING ERRCODE = 'P0002';
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION soft_delete_member(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION soft_delete_member(UUID, UUID) TO service_role;

COMMENT ON COLUMN user_profiles.deleted_at IS
  '소프트 삭제 시각. NULL=활성. 삭제 시 email 익명화(deleted-XXXXXXXX@anon.local) + auth.users ban 처리.';
