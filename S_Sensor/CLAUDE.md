# S_Sensor — CLAUDE.md (구현)

> **모듈**: 채널 1 (CRM 화면 자동 캡쳐).
> **상위**: `../CLAUDE.md`
> **하네스 룰 원본**: `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/S_Sensor/CLAUDE.md`
> **v0.4 상태**: Extension MV3 + DB 마이그레이션(captures·runtime·queue·admin_audit) + 백엔드 수신·정규화·Admin API + Next.js Admin UI.

---

## 0. 목차

| 키워드 | 섹션 |
|---|---|
| 정체성 | § 1 |
| 키워드 → 위치 | § 2 |
| 책임 경계 (러시아 ↔ 한국) | § 3 |
| 데이터 모델 | § 4 |
| 후속 | § 5 |

---

## 1. 정체성

**CRM 화면 자동 캡쳐 채널.** Extension은 캡쳐·송출만. 분류·정규화는 한국 백엔드.

핵심 가설: **H1 (캡쳐 성공률 ≥ 98%)** · **H3 (정규화 시도 100%)** · **H_LLM (multi-image 정확도)**.

---

## 2. 키워드 → 위치

| 키워드 | 위치 |
|---|---|
| MV3 manifest·permissions·host_permissions | `extension/manifest.json` |
| CRM 매트릭스 (data-driven) | DB `crm_definitions` 테이블 → Extension은 GET `/crm-definitions`로 fetch (`extension/lib/crm_rules.js`) · 번들 `extension/crm_definitions.json`은 cold-start fallback |
| URL 매칭·SPA pushState·debounce | `extension/content.js` (CRM 테이블은 background 메시지로 수신) |
| 동적 CRM 규칙 endpoint (HMAC GET) | `backend/functions/crm-definitions/index.ts` |
| captureVisibleTab·quality fallback | `extension/background.js` · `extension/lib/capture.js` |
| 16KB 청크·HMAC·재시도 8회·idempotency | `extension/lib/{chunk,hmac,sender}.js` |
| IndexedDB 큐 1000건·drain·trim | `extension/lib/queue.js` |
| 큐 상태 popup·로그 export | `extension/popup.{html,js}` · `extension/lib/error.js` |
| captures 테이블·entity_clusters·normalized_fields | `../C_Common/supabase/migrations/002_sensor.sql` |
| Storage 버킷 `captures` (WebP, 30일) | 002_sensor.sql + 001_common cron 주석 |
| HMAC 키 발급 (Extension) | 002_sensor.sql `sensor_api_keys` |
| 백엔드 수신 `captures-chunks` (HMAC·idempotency·청크 hash 검증) | `backend/functions/captures-chunks/index.ts` |
| 백엔드 합성 `captures-finalize` (Storage 업로드·분류·클러스터) | `backend/functions/captures-finalize/index.ts` |
| Deno 미러 helpers (errors·hmac·idempotency·classify·cluster·rules·llm·storage·normalize) | `backend/shared/` |
| 정규화 worker (Claude Vision multi-image · 13 필드 · save_normalized_with_supersede RPC) | `backend/functions/normalize-worker/index.ts` |
| 큐·RPC (lock_pending_queue · save_normalized_with_supersede · requeue) | `../C_Common/supabase/migrations/007_normalize_queue.sql` |
| R_10 룰 DB 관리 (rule_versions · publish_rule) | `../C_Common/supabase/migrations/005_runtime.sql` |
| Admin 편집 RPC (edit_normalized_field · enqueue_normalize_priority) + audit | `../C_Common/supabase/migrations/008_admin_audit.sql` |
| Admin Edge Functions (captures·clusters·field-edit·normalize-trigger) | `backend/functions/admin-*/index.ts` |
| Admin auth · pagination Deno mirrors | `backend/shared/{admin_auth,pagination}.ts` |
| Admin UI (Next.js · S_50) — 캡쳐 목록·클러스터 상세·필드 편집·재정규화 | `admin/` (`@hd/sensor-admin`) |
| Lead scoring (R_10.01·.02·.05 DB 로드 + lib *Core + leads UPDATE + dealer_outputs INSERT) | `backend/shared/lead_scoring.ts` (V_Voice와 동일, 중복 — 다른 shared/와 일관) |

---

## 3. 책임 경계 (러시아 ↔ 한국)

| 러시아 (Extension) | 한국 (Supabase) |
|---|---|
| URL 매칭 (data-driven) | 화면 분류 (R_10.05 screen_kinds) |
| WebP 캡쳐 + 메타 | entity_id 추출 (regex 그룹) |
| 16KB 청크 + HMAC | 청크 합성·hash 검증 |
| IndexedDB 큐 + drain | EntityCluster 묶음 (UPSERT) |
| popup 디버그 | Claude Vision 13 필드 (R_10.06) |
| **분류 X · LLM X · 비밀 X** | normalized_fields upsert + supersede |

---

## 4. 데이터 모델 (002_sensor.sql)

| 테이블 | 책임 |
|---|---|
| `sensor_api_keys` | Extension HMAC 키 (1년 만료, dealer 또는 글로벌) |
| `crm_definitions` | host_pattern + screen_patterns JSONB (Bitrix24 시드) |
| `captures` | 캡쳐 메타 + Storage path + 분류 결과 + 상태 |
| `capture_chunks` | 청크 합성 중간 저장 (finalize 후 정리) |
| `entity_clusters` | 같은 entity_id의 capture_ids 배열 + 정규화 상태 |
| `normalized_fields` | 13 필드 + confidence + model + prompt_version |
| `normalize_audit` | Admin 수동 편집 이력 |

RLS: service_role 전권 / `is_hd_admin()` read + normalized_fields update.

---

## 5. 후속

| 우선 | 영역 |
|---|---|
| H | E2E 통합 테스트 (T_04) — Extension → finalize → cluster → normalize → Admin 편집까지 한 번 흘려보기 |
| H | 정확도 사이클 워크플로 (T_07.02) — `normalized_field_edits` 집계 → 위버 `publish_rule('R_10.06', ...)` → 일괄 재정규화 |
| M | Admin UI 추가 surface — overview 카드(24h 통계)·R_10 버전 편집기(R_20 영역) |
| M | Bitrix24 외 CRM 추가 — `crm_definitions` INSERT만 (코드 변경 X). 신규 row는 5분 안에 백엔드 캐시 자동 갱신 |
| M | pg_cron 등록 — 005·007 마이그레이션 주석 참조. Supabase Dashboard에서 1분 주기로 normalize-worker 호출 |
| L | Extension icons 16/48/128 PNG 자산 추가 |

---

## 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-18 | v0.1 — Extension MV3 골격 + 002_sensor.sql |
| 2026-05-18 | v0.2 — Edge Functions `captures-chunks` / `captures-finalize` + `shared/{hmac,idempotency,classify,cluster}` |
| 2026-05-18 | v0.3 — `005_runtime.sql`(rule_versions·publish_rule) + `007_normalize_queue.sql`(queue·lock·save·requeue RPC) + `normalize-worker` + `shared/{rules,llm,storage,normalize}` |
| 2026-05-18 | v0.4 — `008_admin_audit.sql`(normalized_field_edits·edit_normalized_field·enqueue_normalize_priority RPC) + 4 Admin Edge Functions + `shared/{admin_auth,pagination}` + Next.js Admin UI |
| 2026-05-19 | v0.5 — Phase D.3 — `shared/lead_scoring.ts` (V_Voice 중복) + normalize-worker가 save_normalized 후 scoreLead 호출. deno.json에 `harness2/` alias. `021_disable_trigger_scoring.sql`이 upsert_lead_from_cluster의 PERFORM 라인 제거. |
| 2026-05-25 | v0.6 — Extension CRM 규칙 동적화. `backend/functions/crm-definitions/` (HMAC GET) + `extension/lib/crm_rules.js`(chrome.storage 캐시, 15분 alarm 갱신). content.js는 background에 요청하고 번들 JSON은 cold-start fallback 전용. 한계: manifest `content_scripts.matches`는 빌드 시점 고정 → 신규 CRM 도메인은 여전히 ZIP 재발급. |
