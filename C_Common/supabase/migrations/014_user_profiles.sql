-- 014_user_profiles.sql
-- 회원 관리 — 3등급 (super_admin / admin / regular).
-- super_admin = admin (동일 권한). regular = LLM 키·회원 관리 탭 접근 X.
-- 초대: 관리자가 admin-members Edge Function 으로 inviteUserByEmail → 매직 링크 발송.

-- ----------------------------------------------------------------------------
-- 1. ENUM
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'regular');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. user_profiles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  role           user_role NOT NULL DEFAULT 'regular',
  password_set   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_login_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_profiles_email_idx ON user_profiles(email);
CREATE INDEX IF NOT EXISTS user_profiles_role_idx  ON user_profiles(role);

CREATE TRIGGER trg_user_profiles_updated BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. auth.users → user_profiles 자동 동기화
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_user_profile_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_user_profile_from_auth();

-- ----------------------------------------------------------------------------
-- 4. RPCs (service_role 만 호출 가능 → Edge Function 안에서)
-- ----------------------------------------------------------------------------

-- 현재 인증된 유저의 프로필 — Edge Function이 Bearer 토큰으로 호출
CREATE OR REPLACE FUNCTION get_user_profile_for(p_user_id UUID)
RETURNS TABLE(user_id UUID, email TEXT, role user_role, password_set BOOLEAN, created_at TIMESTAMPTZ, last_login_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT user_id, email, role, password_set, created_at, last_login_at
  FROM user_profiles WHERE user_id = p_user_id;
$$;

-- 관리자: 회원 목록
CREATE OR REPLACE FUNCTION list_user_profiles()
RETURNS TABLE(user_id UUID, email TEXT, role user_role, password_set BOOLEAN, created_at TIMESTAMPTZ, last_login_at TIMESTAMPTZ, invited_by_email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT up.user_id, up.email, up.role, up.password_set, up.created_at, up.last_login_at,
         (SELECT email FROM user_profiles ib WHERE ib.user_id = up.invited_by) AS invited_by_email
  FROM user_profiles up
  ORDER BY up.created_at DESC;
$$;

-- 관리자: 회원 역할 변경
CREATE OR REPLACE FUNCTION set_user_role(p_user_id UUID, p_role user_role, p_actor UUID DEFAULT NULL)
RETURNS user_profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  r user_profiles;
BEGIN
  -- super_admin 0명 보호: 마지막 super_admin 강등 금지
  IF p_role <> 'super_admin' THEN
    IF (SELECT role FROM user_profiles WHERE user_id = p_user_id) = 'super_admin'
       AND (SELECT COUNT(*) FROM user_profiles WHERE role = 'super_admin') <= 1 THEN
      RAISE EXCEPTION 'cannot demote the last super_admin' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE user_profiles SET role = p_role, updated_at = now()
  WHERE user_id = p_user_id RETURNING * INTO r;
  IF r IS NULL THEN RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002'; END IF;
  RETURN r;
END;
$$;

-- 초대 직후 invited_by + role 동시 기록 (Edge Function 이 createUser/invite 후 호출)
CREATE OR REPLACE FUNCTION register_invited_user(p_user_id UUID, p_role user_role, p_invited_by UUID)
RETURNS user_profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE r user_profiles;
BEGIN
  INSERT INTO user_profiles (user_id, email, role, password_set, invited_by)
  SELECT p_user_id, email, p_role, FALSE, p_invited_by FROM auth.users WHERE id = p_user_id
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        invited_by = COALESCE(user_profiles.invited_by, EXCLUDED.invited_by),
        updated_at = now()
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- 사용자가 비번 설정 완료 시 호출 (Edge Function 안에서 service_role 로)
CREATE OR REPLACE FUNCTION mark_password_set(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE user_profiles SET password_set = TRUE, last_login_at = now()
  WHERE user_id = p_user_id;
END;
$$;

-- 로그인 기록
CREATE OR REPLACE FUNCTION touch_last_login(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE user_profiles SET last_login_at = now() WHERE user_id = p_user_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. is_hd_admin() 갱신 — user_profiles 기반 (super_admin OR admin)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_hd_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
      AND role IN ('super_admin', 'admin')
  );
$$;

-- ----------------------------------------------------------------------------
-- 6. RLS · GRANT
-- ----------------------------------------------------------------------------
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 본인 프로필은 항상 본인이 SELECT
CREATE POLICY up_self_read ON user_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 관리자는 전체 SELECT
CREATE POLICY up_admin_read ON user_profiles
  FOR SELECT TO authenticated USING (is_hd_admin());

-- service_role 전권
CREATE POLICY up_service ON user_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION list_user_profiles()                          FROM PUBLIC;
REVOKE ALL ON FUNCTION set_user_role(UUID, user_role, UUID)          FROM PUBLIC;
REVOKE ALL ON FUNCTION register_invited_user(UUID, user_role, UUID)  FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_password_set(UUID)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION touch_last_login(UUID)                        FROM PUBLIC;
REVOKE ALL ON FUNCTION get_user_profile_for(UUID)                    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_user_profiles()                       TO service_role;
GRANT EXECUTE ON FUNCTION set_user_role(UUID, user_role, UUID)       TO service_role;
GRANT EXECUTE ON FUNCTION register_invited_user(UUID, user_role, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION mark_password_set(UUID)                    TO service_role;
GRANT EXECUTE ON FUNCTION touch_last_login(UUID)                     TO service_role;
GRANT EXECUTE ON FUNCTION get_user_profile_for(UUID)                 TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Bootstrap — 기존 auth.users 행이 있으면 user_profiles 백필 + 첫 유저 super_admin
-- ----------------------------------------------------------------------------
INSERT INTO user_profiles (user_id, email)
SELECT id, email FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 부트스트랩 유저는 super_admin 으로 승격. password_set 은 FALSE 유지 → 다음 페이지 로드 시 /set-password 강제.
UPDATE user_profiles
SET role = 'super_admin'
WHERE user_id = (
  SELECT user_id FROM user_profiles ORDER BY created_at ASC LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE role = 'super_admin');

COMMENT ON TABLE user_profiles IS '회원 등급 + 초대/비번 설정 추적. role=super_admin/admin/regular.';
