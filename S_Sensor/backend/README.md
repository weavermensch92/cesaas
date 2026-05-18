# S_Sensor — Backend (Supabase Edge Functions, Deno)

> 한국 측 — Extension 청크 수신·합성·분류·EntityCluster UPSERT.

## 엔드포인트

| Path | 본질 | 가설 |
|---|---|---|
| `POST /captures-chunks` | 청크 1건 수신 + capture_chunks INSERT | H1 |
| `POST /captures-finalize` | 합성·hash 검증·Storage 업로드·분류·클러스터 | H1·H3 |
| `POST /normalize-worker` | 큐 N개 픽업 + Claude Vision 13 필드 + RPC 저장 | H3·H_LLM |

> 함수 URL은 `https://{ref}.supabase.co/functions/v1/{name}`. `normalize-worker`는 pg_cron이 1분마다 호출 (007_normalize_queue.sql 주석 참조).

## 디렉토리

```
backend/
├── deno.json
├── functions/
│   ├── captures-chunks/index.ts
│   ├── captures-finalize/index.ts
│   └── normalize-worker/index.ts
└── shared/
    ├── env.ts           env 접근
    ├── db.ts            service-role Supabase client
    ├── errors.ts        ApiError + JSON response (Deno 미러: @hd/core/errors)
    ├── hash.ts          SHA-256 + constant-time compare
    ├── hmac.ts          verifyHmac (sensor_api_keys + hmac_nonces)
    ├── idempotency.ts   processed_events 룩업·기록
    ├── logger.ts        구조화 JSON 로깅 + requestLogger
    ├── classify.ts      crm_definitions JSONB 기반 URL regex 분류
    ├── cluster.ts       entity_clusters UPSERT (UNIQUE 경쟁 안전)
    ├── rules.ts         rule_versions DB 로더 (5분 캐시) — R_10 hot reload
    ├── llm.ts           Anthropic 래퍼 · callRule(rule_id, prompt_key) · 지수 백오프
    ├── storage.ts       captures 버킷 download + base64
    └── normalize.ts     buildClusterImages · 다양화 선택 · parseLlmFields
```

## 배포

```powershell
# 1) supabase CLI 로그인
supabase login

# 2) 프로젝트 link (이 폴더 또는 상위에서)
supabase link --project-ref __SUPABASE_REF__

# 3) 시크릿 주입
supabase secrets set SUPABASE_URL=https://__ref__.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
supabase secrets set LOG_LEVEL=info

# 4) Anthropic 키 (normalize-worker만 사용)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set ANTHROPIC_MODEL_PRIMARY=claude-opus-4-7

# 5) 함수 배포
supabase functions deploy captures-chunks   --project-ref __ref__ --no-verify-jwt
supabase functions deploy captures-finalize --project-ref __ref__ --no-verify-jwt
supabase functions deploy normalize-worker  --project-ref __ref__ --no-verify-jwt

# 6) pg_cron 등록 (Supabase Dashboard SQL editor에서)
#   007_normalize_queue.sql 맨 아래 주석 블록 복사·실행.
#   1분 주기로 normalize-worker 호출.
```

> HMAC 키는 DB의 `sensor_api_keys` 행으로 직접 INSERT — 시크릿은 Supabase secrets에는 두지 않고 DB row에 저장 (회수·dealer 단위 발급을 위해). dealer 단위 키 발급은 위버 R_20 도구로.

## 시크릿 / 환경변수

| 키 | 의미 |
|---|---|
| `SUPABASE_URL` | 자체 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT — RLS 우회 |
| `ANTHROPIC_API_KEY` | normalize-worker 전용 |
| `ANTHROPIC_MODEL_PRIMARY` | 기본 `claude-opus-4-7` |
| `LOG_LEVEL` | `debug | info | warn | error` (기본 `info`) |

## 책임 경계 (러시아 ↔ 한국)

| 러시아 (Extension) | 이 백엔드 |
|---|---|
| URL 매칭·캡쳐·청크·HMAC 송출 | 청크 수신·hash 검증·합성 |
| meta 부착 (url·viewport·dpr) | crm_definitions로 분류 (URL regex) |
| IndexedDB 큐·8회 재시도 | EntityCluster UPSERT (UNIQUE 경쟁 안전) |
| **분류 X · LLM X** | LLM 정규화 워커는 별도 함수 (예정) |

## 통과 기준 (H1)

- HMAC 검증 통과율 ≥ 98% (정상 트래픽)
- Idempotency 재시도 시 같은 응답 반환 (24h)
- 청크 hash 불일치 시 422 + capture 상태 `failed`
- finalize 후 `status = 'classified'` 또는 `'clustered'`

상세 — `../../PRD/PRD_01_Sensor.md` § 7·8 + `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/S_Sensor/S_20_Backend/`.
