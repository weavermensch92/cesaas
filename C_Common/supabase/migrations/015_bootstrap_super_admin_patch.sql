-- 015 — 014에서 password_set=TRUE 로 부트스트랩한 super_admin을 FALSE 로 되돌려
-- 다음 로그인 시 /set-password 로 강제 이동하도록 (PoC 운영 첫 번째 유저용).
UPDATE user_profiles
SET password_set = FALSE
WHERE role = 'super_admin'
  AND password_set = TRUE
  AND user_id = (SELECT user_id FROM user_profiles ORDER BY created_at ASC LIMIT 1);
