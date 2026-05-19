# T_Test — CLAUDE.md (구현)

> **모듈**: 가설 측정·E2E·우회 시나리오.
> **상위**: `../CLAUDE.md`
> **하네스 룰 원본**: `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/T_Test/CLAUDE.md`
> **v0.5 상태**: T_04 + T_05 + T_06 + **T_07.01 호스팅 전환** (Fly.io fallback runner) + **T_07.02 외부 컨트롤 사이클** + T_07.04·.05 (문서·매뉴얼) + T_08 통과 판정 페이지.

---

## 0. 정체성

가설을 **자동 실행 가능한 형태**로 측정. test_runs/test_assertions DB 누적 → T_08 통과 판정 표 직접 쿼리.

---

## 1. 키워드 → 위치

| 키워드 | 위치 |
|---|---|
| test_runs · test_assertions · finish_test_run RPC | `../C_Common/supabase/migrations/011_test_runs.sql` |
| Runner workspace (`@hd/t-test`) | `runner/package.json` |
| HMAC 서명 · JWT 발급 helpers | `runner/lib/{hmac,jwt,http}.ts` |
| 픽스처 (WebP 1×1·dealer/visitor axis·answers) | `runner/lib/fixtures.ts` |
| Sensor E2E helpers (provision key · send chunks · poll cluster) | `runner/lib/sensor-helpers.ts` |
| assert / pass / fail / metric | `runner/lib/assert.ts` |
| Voice 응답 송출 helpers | `runner/lib/voice-helpers.ts` |
| T_04 Sensor 시나리오 | `runner/bin/run-t04.ts` |
| T_05 Voice 시나리오 | `runner/bin/run-t05.ts` |
| **T_06 통합 시나리오** | `runner/bin/run-t06.ts` |
| **T_07.01 호스팅 전환** (Fly.io fallback /health + Dealer post 검증) | `runner/bin/run-t07-01.ts` (T_TEST_FALLBACK_BASE 설정 시 활성) |
| Fly.io Edge fallback 인프라 | `../fly_edge/` (main.ts·Dockerfile·fly.toml) + `../DEPLOY-FALLBACK.md` |
| **T_07.02 외부 컨트롤 사이클** (publish_rule rotation + retrigger queue) | `runner/bin/run-t07.ts` |
| T_07.04 5 시나리오 (VPN·독립·청크·Studio·HD) — 문서 | `T_07_docs/T_07.04_documentation_scenarios.md` |
| T_07.05 부스 회복 매뉴얼 — 30초 cheat-sheet | `T_07_docs/T_07.05_booth_recovery_manual.md` |
| 일괄 실행 (T_04+T_05+T_06) | `runner/bin/run-all.ts` |
| **T_08 통과 판정 — 9 지표 자동 채점 API** | `backend/functions/admin-test-summary/index.ts` |
| **T_08 통과 판정 페이지 (KPI + 가설 표 + runs)** | `../S_Sensor/admin/app/t-test/page.tsx` |

---

## 2. 시나리오·가설 매핑

| 시나리오 | 가설 | 측정 |
|---|---|---|
| T_04 send (chunks·finalize) | H1 | `success_rate (%) ≥ 98`, finalize `p95_ms` |
| T_04 cluster (entity 묶음 3장+) | H3 | `image_count ≥ 3` |
| T_04 normalize (LLM opt-in) | H3 · H_LLM | normalized_fields(active) 생성, prompt_version 추적 |
| T_05 dealer (Bearer + answers) | V_가설 | 200 + 서버측 segment 일치 + answers row count 일치 |
| T_05 visitor (anonymous) | V_가설 | 200 + 서버측 segment 일치 + opt-in=false 시 contact_* NULL |
| T_05 quota (옵션) | V_가설 | 6번째 시도 429 rate_limited |
| **T_06 unified** | **H_채널통합** | 같은 entity → 1 lead, sensor_count≥1 AND voice_count≥1, score>0, dealer_outputs(active)=1, lead_links 양 source |
| T_06 score / output | H_채널통합 | leads.score>0 + dealer_outputs(active) priority/segment 결정 |
| **T_07.02 외부 컨트롤** | **H_외부컨트롤·H_하네스2** | publish_rule rotation (이전 archived + 새 active + rule_audit 1 row) + enqueue_normalize_priority로 normalize_queue에 high priority row 추가. cleanup 시 baseline 직접 복원 (test 잔재 0) |

---

## 3. 실행

```powershell
# 의존성
npm install

# 환경
Copy-Item T_Test\runner\.env.example T_Test\runner\.env.local
# → SUPABASE_URL · SERVICE_ROLE · VOICE_JWT_SECRET 채우기

# 개별
npm run t04 -w @hd/t-test
npm run t05 -w @hd/t-test
npm run t06 -w @hd/t-test
npm run t07 -w @hd/t-test  # 외부 컨트롤 사이클 — publish_rule + retrigger. LLM 비용 X

# T_07.01 호스팅 전환 — fly_edge 배포 후 활성
$env:T_TEST_FALLBACK_BASE='https://hd-poc-edge.fly.dev'
npm run t07-01 -w @hd/t-test

# 일괄 (T_04+T_05+T_06)
npm run all -w @hd/t-test

# LLM 정규화까지 측정 (Anthropic 비용)
npm run t04 -w @hd/t-test -- --llm

# Voice quota 검증 (24h 한도 5건)
$env:T_TEST_QUOTA='true'
npm run t05 -w @hd/t-test
```

각 실행 한 건 = `test_runs` row + `test_assertions` 여러 row. Admin SQL 또는 SELECT:

```sql
SELECT suite, scenario, status, passed_count, failed_count, duration_ms
  FROM test_runs ORDER BY started_at DESC LIMIT 20;

SELECT step, name, hypothesis, status, metric_name, metric_value
  FROM test_assertions WHERE run_id = '<id>' ORDER BY seq;
```

---

## 4. 통과 판정 입력 (T_08 미리)

```sql
-- H1 송출 성공률
SELECT avg(metric_value) AS h1_success_rate
  FROM test_assertions
 WHERE hypothesis = 'H1' AND metric_name = 'success_rate';

-- H3 정규화 시도
SELECT count(*) FILTER (WHERE status='pass') * 100.0 / count(*) AS h3_attempt_rate
  FROM test_assertions WHERE hypothesis = 'H3';

-- V_가설 응답 자산화
SELECT count(*) FILTER (WHERE status='pass') AS v_passed,
       count(*) FILTER (WHERE status='fail') AS v_failed
  FROM test_assertions WHERE hypothesis = 'V_가설';
```

---

## 5. 후속

| 우선 | 영역 |
|---|---|
| H | T_06 확장 — Visitor + Sensor 통합 (현재는 Dealer만), 다국어 응답, R_10.07 풀 payload 검증 |
| H | Phase 2 — fly_edge에 captures-chunks·captures-finalize 추가 (Sensor 경로) + Dealer 단말 측 fallback wiring |
| M | T_07.03 multi-image 다양화 — LLM 비용 의존, --llm 플래그로 |
| ✓ | ~~T_08 통과 판정~~ — v0.3에서 `/t-test` 페이지 완성 |
| M | T_02 H1 측정 — 실 부스 트래픽 (출장 중) — runner를 daemon으로 |
| L | fixture 다양화 — Bitrix24 실 캡쳐 샘플 5장 + 다국어 응답 |

---

## 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-18 | v0.1 — `011_test_runs.sql` + `@hd/t-test` runner (T_04 Sensor 풀 + T_05 Voice 풀 + assertion 저장) |
| 2026-05-18 | v0.2 — `run-t06.ts` 통합 E2E (Sensor capture + Voice response 같은 entity_id → leads UNIQUE, sensor/voice count, score, dealer_outputs, lead_links 양 source 검증) + `lib/voice-helpers.ts` |
| 2026-05-18 | v0.3 — `admin-test-summary` Edge Function (9 정량 지표 자동 채점·verdict pass/partial/fail·가설별 누적·최근 runs) + Next.js `/t-test` 페이지 (verdict 카드·KPI 그리드·표) |
| 2026-05-19 | v0.4 — Phase T_07: `run-t07.ts` 외부 컨트롤 사이클 mechanics 자동화 (R_10.06 publish_rule rotation + cluster 준비 + enqueue_normalize_priority retrigger + baseline 복원). T_07.04 5 시나리오 문서 (VPN·독립·청크·Studio·HD) + T_07.05 부스 회복 매뉴얼 (30초 cheat-sheet). T_07.01·.03은 인프라/LLM 의존 — runner 후속 |
| 2026-05-19 | v0.5 — Phase T_07.01: `fly_edge/` Fly.io Edge fallback 인프라 (main.ts router · Dockerfile · fly.toml · .dockerignore) + `DEPLOY-FALLBACK.md` 수동 배포 절차. `responses-receive` Edge Function을 handler.ts + index.ts로 분리 (Supabase Edge와 Fly.io 양쪽이 동일 핸들러). `run-t07-01.ts` runner — T_TEST_FALLBACK_BASE 설정 시 /health + dealer post 검증, 미설정 시 skip. CLAUDE 명세상 부스 critical path 1개만 mirror (Phase 2에서 sensor 경로 추가). |
