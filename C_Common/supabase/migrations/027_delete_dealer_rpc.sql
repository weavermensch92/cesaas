-- 027_delete_dealer_rpc.sql
-- 딜러 삭제 — 토큰·키 cascade 정리 + dealer row 삭제.
-- responses 테이블의 dealer_id 는 TEXT (FK 아님) — 리드/응답 데이터는 유지.

CREATE OR REPLACE FUNCTION delete_dealer(p_dealer_id TEXT)
RETURNS TABLE(
  deleted_voice_tokens BIGINT,
  deleted_sensor_keys  BIGINT,
  dealer_removed       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voice  BIGINT;
  v_sensor BIGINT;
  v_dealer BIGINT;
BEGIN
  DELETE FROM voice_dealer_tokens WHERE dealer_id = p_dealer_id;
  GET DIAGNOSTICS v_voice = ROW_COUNT;

  DELETE FROM sensor_api_keys WHERE dealer_id = p_dealer_id;
  GET DIAGNOSTICS v_sensor = ROW_COUNT;

  DELETE FROM dealers WHERE dealer_id = p_dealer_id;
  GET DIAGNOSTICS v_dealer = ROW_COUNT;

  RETURN QUERY SELECT v_voice, v_sensor, v_dealer > 0;
END;
$$;

COMMENT ON FUNCTION delete_dealer(TEXT) IS
  '딜러 삭제 — 토큰·키 hard delete + dealers row 삭제. responses 는 untouched (dealer_id TEXT 유지).';

REVOKE ALL ON FUNCTION delete_dealer(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_dealer(TEXT) TO service_role;
