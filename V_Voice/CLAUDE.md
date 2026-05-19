# V_Voice — CLAUDE.md (구현)

> **모듈**: 채널 2 (Dealer 인터뷰 · Visitor PWA · Admin · Studio).
> **상위**: `../CLAUDE.md`
> **하네스 룰 원본**: `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/V_Voice/CLAUDE.md`
> **v0.5 상태**: v0.4 + **V_30.04 Admin Dealer 계정 발급 UI (issue·list·revoke + QR + 응답 카운트)**.

---

## 0. 목차

| 키워드 | 섹션 |
|---|---|
| 정체성 | § 1 |
| 키워드 → 위치 | § 2 |
| 데이터 모델 (003_voice.sql) | § 3 |
| 책임 경계 (러시아 ↔ 한국) | § 4 |
| 후속 | § 5 |

---

## 1. 정체성

**부스 응답을 본사 자산으로 정량화하는 채널.** Dealer 31문항(v3 단일 HTML) + Visitor PWA 18문항 + Admin 집계 + Studio 자연어 빌드.

핵심 가설: **V_가설**(응답 수집·segment 매칭) · **H_채널통합**(entity_id 매핑).

---

## 2. 키워드 → 위치

| 키워드 | 위치 |
|---|---|
| surveys·survey_questions·responses·response_answers + 시드 31문항 | `../C_Common/supabase/migrations/003_voice.sql` |
| save_response RPC (responses + answers 트랜잭션) | `../C_Common/supabase/migrations/003_voice.sql` |
| Dealer v3 단일 HTML (오프라인·IndexedDB·R_10.05·R_10.07 inline + ru/en/ko 4쪽 튜토리얼 + 응답 후 server Playbook fetch + live 배지) | `dealer/index.html` |
| 응답 수신 Edge Function — Supabase 진입점 (Deno.serve 1줄) | `backend/functions/responses-receive/index.ts` |
| 응답 수신 핸들러 — Bearer/Anonymous + idempotency + segment 재검증 + scoreLead. Supabase Edge + Fly.io Edge fallback이 양쪽에서 import | `backend/functions/responses-receive/handler.ts` |
| Dealer Bearer JWT 검증 + jti revoke 차단 + Anonymous device_id | `backend/shared/bearer.ts` |
| 딜러 본인 상담 이력 Edge Function (`list_dealer_consultations` RPC 래퍼) | `backend/functions/dealer-consultations/index.ts` |
| 딜러 Playbook fetch Edge Function (lead_id별 active dealer_outputs · 소유권 검증) | `backend/functions/dealer-playbook/index.ts` |
| `responses.target_company` 컬럼 + `list_dealer_consultations` RPC + `save_response` 시그니처 확장 | `../C_Common/supabase/migrations/016_dealer_consultation.sql` |
| Admin Dealer 계정 발급·목록·폐기 Edge Functions | `backend/functions/dealer-tokens-{issue,list,revoke}/index.ts` |
| Admin Dealer 계정 UI (gridge_admin 전용 · 발급 폼·QR·목록·딜러별 응답 수) | `../S_Sensor/admin/app/voice/dealers/page.tsx` |
| voice_dealer_tokens 운영 메타 (label·issued_by) | `../C_Common/supabase/migrations/017_dealer_tokens_meta.sql` |
| 서버 측 segment 매칭 — R_10.05 DB → R_10.06.segment_classifier LLM 보조 (V-004) → inline fallback 3단계 | `backend/shared/segments.ts` |
| Lead scoring (R_10.01·.02·.05 DB 로드 + lib *Core + leads UPDATE + dealer_outputs INSERT) | `backend/shared/lead_scoring.ts` |
| 공통 helpers (errors·db·hash·env·idempotency·logger) | `backend/shared/*.ts` (S_Sensor 재export) |
| Visitor PWA (단일 HTML · Service Worker · IndexedDB · 옵트인 명함 · hCaptcha 옵션) | `visitor/index.html` · `visitor/sw.js` · `visitor/manifest.webmanifest` |
| Visitor 옵트인 컬럼·24h quota·시드 18문항 | `../C_Common/supabase/migrations/009_voice_visitor.sql` |
| Voice Admin Edge Functions (목록·집계·CSV) | `backend/functions/voice-{responses,aggregates,csv-export}/index.ts` |
| Voice Admin UI (목록·필터·NPS·옵트인·CSV·익명 CSV·Insight v0) | `../S_Sensor/admin/app/voice/{responses,aggregates}/page.tsx` |
| Section nav (Captures ↔ Voice·Responses ↔ Voice·Insight) | `../S_Sensor/admin/app/components/SectionNav.tsx` |
| Studio 빌드/배포 Edge Functions + draft 테이블 + deploy_survey RPC | `backend/functions/studio-{build-survey,deploy}/index.ts` · `../C_Common/supabase/migrations/010_studio.sql` |
| Studio UI (자연어 입력 → 검토·편집 → 배포) — gridge_admin 전용 | `../S_Sensor/admin/app/studio/page.tsx` |
| 자연어 빌드 프롬프트 | `../C_Common/r_10_rules/R_10.06_PromptTemplates.yaml` (`voice_studio_survey_build`) + `R_10.08_SurveyBuildPrompt.yaml` (메타) |

---

## 3. 데이터 모델 (003_voice.sql)

| 테이블 | 책임 |
|---|---|
| `voice_dealer_tokens` | QR로 발급된 Bearer 토큰 레지스트리 (jti unique·revoke 가능) |
| `surveys` | Studio 또는 manual seed. `survey_v1_dealer` 시드 포함 |
| `survey_questions` | 6 axis + 7 marketing + NPS + 2 consent 시드 (ru/en/ko 다국어 옵션) |
| `responses` | nps·future_subscription·consent + segment + axis_data JSONB + lead_id |
| `response_answers` | (response_id, question_id) UNIQUE — idempotent INSERT |

RLS: service_role 전권 / `is_hd_admin()` read.

---

## 4. 책임 경계 (러시아 ↔ 한국)

| 러시아 (Dealer v3 단일 HTML) | 한국 (Edge Function) |
|---|---|
| 6 axis · 7 marketing · NPS · consent 입력 | Bearer JWT verify (voice_dealer_tokens) |
| 클라이언트 R_10.05 segment 매칭 | 서버측 R_10.05 재계산 — 불일치 시 서버 우선 + confidence 0.8 cap |
| 클라이언트 R_10.07 Playbook 즉시 표시 | `save_response` RPC (responses + answers 트랜잭션) |
| IndexedDB 큐 + online 자동 drain | Idempotency-Key 24h |
| 다국어 ru/en/ko 토글 (i18n inline) | LeadScoring/Lead 응집은 U_Unified가 별도 트리거 |

---

## 5. 후속

| 우선 | 영역 |
|---|---|
| H | Admin V_30 (Sensor Admin Next.js에 `/voice/responses` 라우트 추가) — 목록·segment 카운트·NPS 평균·CSV·옵트인 contact view |
| H | PII 익명화 cron (30일 후 `contact_*` 컬럼 NULL + `pii_redacted_at` set) — C_07 보안·법무 |
| H | E2E (T_05) — Dealer/Visitor 한 번 흘려서 V_가설·H_채널통합 측정 |
| M | Studio V_60 (자연어 → 설문 빌드) — R_10.08 PromptTemplates 사용 |
| M | LeadScoring 트리거 — U_Unified의 LeadScoring RPC 추가 후 responses INSERT 트리거 연결 |
| M | PWA 아이콘 (192/512 PNG) 실제 자산 추가 — `visitor/icons/README.md` |
| L | dealer/visitor에서 i18n·SURVEY를 server fetch (`GET /surveys/{id}`)로 override 시도. fail 시 inline fallback 유지 |

---

## 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-18 | v0.1 — `003_voice.sql`(surveys 시드 포함) + `dealer/index.html`(단일 HTML, 오프라인, R_10.05/R_10.07 inline) + `responses-receive` Edge Function + `shared/{bearer,segments}` |
| 2026-05-18 | v0.2 — `009_voice_visitor.sql`(survey_v1_visitor 18문항·옵트인 컬럼·visitor_quota RPC) + `visitor/{index.html,sw.js,manifest.webmanifest}` (PWA·IndexedDB·honeypot) + `responses-receive` 확장 (opt-in 연락처·24h quota) |
| 2026-05-18 | v0.3 — V_30 Admin: 3 Edge Functions (voice-responses·voice-aggregates·voice-csv-export) + Next.js `/voice/responses`·`/voice/aggregates` + `SectionNav` |
| 2026-05-18 | v0.4 — V_60 Studio: `010_studio.sql`(studio_drafts·deploy_survey RPC) + 2 Edge Functions (studio-build-survey·studio-deploy) + Next.js `/studio` + `shared/{llm,rules}` re-export |
| 2026-05-19 | v0.5 — V_30.04 Admin Dealer 계정 발급: `017_dealer_tokens_meta.sql`(label·issued_by) + 3 Edge Functions (`dealer-tokens-{issue,list,revoke}`) + Next.js `/voice/dealers` (QR 인라인) + `bearer.ts` jti revoke 차단 강화 |
| 2026-05-19 | v0.5.1 — Dealer 첫 접속 튜토리얼 4쪽 (ru/en/ko) 추가. 헤더 `?` 버튼으로 재호출. `localStorage.hd_dealer_tutorial_seen_v1`로 1회 자동 노출. |
| 2026-05-19 | v0.5.2 — 딜러 본인 "내 이력" 화면: `dealer-consultations` Edge Function(016 RPC 래퍼) + dealer/index.html 헤더 이력 토글 + ru/en/ko 라벨. 부스 현장에서 어제·오늘 누구 만났는지 즉시 확인. |
| 2026-05-19 | v0.5.3 — target_company 자동완성: dealer-consultations prefetch → distinct 회사명 20개를 `<datalist>`로 노출. 신규 입력 회사명도 즉시 최상단 반영. 표기 통일(예: Hyundai/Хёндэ/현대) 효과. |
| 2026-05-19 | v0.5.4 — /voice/responses 검색·필터 확장: voice-responses Edge에 `target_company` ilike(부분 일치) + `dealer_id` eq 파라미터, Admin UI에 검색 바 (350ms debounce) + 활성 필터 표시. |
| 2026-05-19 | v0.6 — Phase D.3 scoring 이전: `shared/lead_scoring.ts` (R_10.01·.02·.05 DB 로드 + lib *Core + leads UPDATE + dealer_outputs INSERT). responses-receive가 save 후 호출. `021_disable_trigger_scoring.sql`이 trigger의 `PERFORM score_lead` 제거. NF-P01 hot reload 완전 실 동작. |
| 2026-05-19 | v0.7 — Phase F (V-009 서버 Playbook 갱신): `022_seed_r10_07_dealer_output.sql`로 R_10.07 DB 시드. `lead_scoring.ts`가 R_10.07 로드 후 segment lookup → dealer_outputs.{title·weapons·pitch·models·next_action} 풀 payload 채움 (이전: title만). `dealer-playbook` Edge Function (Bearer JWT + lead_id 소유권 검증 + active output 조회). responses-receive 응답에 lead_id 포함 (단말 fetch 용이). 다음: Phase E — dealer/index.html이 fetch한 playbook 표시 (현재 inline). |
| 2026-05-20 | v0.8 — Phase E (dealer fetch wiring): dealer/index.html이 응답 송출 후 GET /dealer-playbook?lead_id=X로 server Playbook fetch → renderResult가 inline 대신 server 페이로드 표시. 실패 시 inline fallback(오프라인 부스 정상). 'live' 배지로 server fetch 표시. state.{pendingIdemKey, serverPlaybook, serverPlaybookSource} 추적, navReset 시 리셋. R_10.07 hot reload 사이클이 부스 단말까지 닫힘. |
| 2026-05-20 | v0.9 — V-004 segment LLM fallback: R_10.06.segment_classifier (Claude Haiku) 템플릿 추가 (`023_reseed_r10_06_segment_classifier.sql`). segments.ts classifyServerSide가 deterministic이 'other' 반환 + axis.usage 있을 때만 LLM 보조 호출 — 비용 게이트. method 값 'server_llm' 추가. LLM 실패 시 deterministic 결과 유지. |
| 2026-05-20 | v1.0 — V-026 hCaptcha (visitor bot 방지): visitor/index.html이 HCAPTCHA_SITE_KEY 설정 시 widget 자동 로드·렌더 (opt-in 화면) + token 캡쳐 후 payload `hcaptcha_token` 첨부. responses-receive handler가 HCAPTCHA_SECRET 설정 시만 siteverify 호출 — 양쪽 키 미설정 시 honeypot only 동작 (default). dealer는 Bearer JWT라 skip. |
