# @hd/t-test — E2E Test Runner

> T_04 Sensor + T_05 Voice + **T_06 통합(Sensor+Voice 같은 Lead 응집)** 자동 측정. 결과는 `test_runs` / `test_assertions` 테이블 누적 → T_08 통과 판정 표 직접 SELECT.

## 빠른 시작

```powershell
# 1) 의존성 (루트에서 한 번)
npm install

# 2) .env.local 채우기
Copy-Item .env.example .env.local
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOICE_JWT_SECRET 필수

# 3) 마이그레이션 (전체 11개 적용 필요)
supabase migration up

# 4) 모든 Edge Function 배포 — captures-chunks, captures-finalize, normalize-worker, responses-receive (+ admin / voice / studio)
supabase functions deploy captures-chunks captures-finalize normalize-worker responses-receive --no-verify-jwt

# 5) 일괄 실행
npm run all -w @hd/t-test
```

## 출력 예

```
=== T_04 · sensor_full · run a1b2c3d4 ===
  ✓ provision · sensor_api_keys INSERT (45ms)
  ✓ send · capture 9f2e3a delivered [finalize_ms=842] (842ms)
  ✓ send · capture 4b1c8d delivered [finalize_ms=731] (731ms)
  ✓ send · capture 2e7a5b delivered [finalize_ms=798] (798ms)
  ✓ metric_h1 · chunk success_rate ≥ 98% [success_rate=100]
  ✓ metric_h1 · finalize P95 latency [p95_ms=842]
  ✓ cluster · entity_clusters image_count ≥ 3 [image_count=3]
  ✓ normalize_attempt · normalize_queue 진입 확인 (H3 attempt 100%)

→ T_04·sensor_full: passed (pass 8 · fail 0 · skip 0 · 12340ms)
```

## 환경 플래그

| 변수 | 기본 | 효과 |
|---|---|---|
| `T_TEST_LLM` | `false` | `true` 또는 `--llm` 시 Claude Vision까지 호출 (비용 발생) |
| `T_TEST_QUOTA` | `false` | `true` 시 Visitor 24h 5건 한도 (6번째 = 429) 검증 |
| `T_TEST_NORMALIZE_TIMEOUT_MS` | `120000` | normalize-worker 폴링 timeout |
| `T_TEST_CLEANUP` | `true` | `false` 시 fixture data 보존 (수동 검증용) |
| `T_TEST_ACTOR` | `weaver@gridge.co.kr` | test_runs.actor 표시 |
| `T_TEST_ENV` | `dev` | `dev`·`staging`·`prod` 분리 집계 |

## 측정 결과 SELECT

```sql
-- 최근 20 runs
SELECT suite, scenario, status,
       passed_count, failed_count, duration_ms,
       to_char(started_at, 'YYYY-MM-DD HH24:MI') AS at
  FROM test_runs ORDER BY started_at DESC LIMIT 20;

-- 특정 run 상세
SELECT seq, step, name, hypothesis, status, metric_name, metric_value, duration_ms
  FROM test_assertions WHERE run_id = '<id>' ORDER BY seq;

-- 가설별 누적
SELECT hypothesis, status, count(*)
  FROM test_assertions
 WHERE created_at > now() - interval '24 hours'
 GROUP BY hypothesis, status
 ORDER BY hypothesis, status;
```

## 책임 경계 (테스트 ↔ 실 서비스)

| Runner (이 폴더) | 백엔드 |
|---|---|
| 합성 fixture (WebP 1×1·dealer/visitor axis) | 실 Edge Function 그대로 호출 |
| HMAC 키 즉시 provision + 사용 후 revoke | `sensor_api_keys` RLS service_role |
| Dealer JWT in-process sign | `voice_dealer_tokens` row (cleanup) |
| 폴링 + 정량 metric 기록 | normalize-worker는 실 pg_cron으로 픽업 |
| cleanup=true 시 fixture rows 삭제 | 30일 cron이 잔여 데이터 정리 |

상세 — `../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/T_Test/`.
