-- 012_cron.sql — pg_cron 정기 작업 등록 (시크릿 불필요한 2개)
-- normalize_pump (3번째) 는 service_role_key 가 필요해 운영자가 Dashboard SQL Editor에서 별도 등록.

-- 1. 30일 지난 captures 자동 삭제 (매일 03:00 KST = 18:00 UTC)
SELECT cron.schedule(
  'delete_old_captures', '0 18 * * *',
  $$
    DELETE FROM captures WHERE created_at < now() - interval '30 days';
    DELETE FROM storage.objects WHERE bucket_id = 'captures'
      AND created_at < now() - interval '30 days';
  $$
);

-- 2. idempotency·HMAC nonce 만료 청소 (5분마다)
SELECT cron.schedule(
  'cleanup_idempotency', '*/5 * * * *',
  'SELECT cleanup_idempotency_expired();'
);
