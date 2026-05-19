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
| Dealer v3 단일 HTML (오프라인·IndexedDB·R_10.05·R_10.07 inline + ru/en/ko 4쪽 첫 접속 튜토리얼) | `dealer/index.html` |
| 응답 수신 Edge Function (Bearer/Anonymous + idempotency + 서버측 segment 재검증) | `backend/functions/responses-receive/index.ts` |
| Dealer Bearer JWT 검증 + jti revoke 차단 + Anonymous device_id | `backend/shared/bearer.ts` |
| Admin Dealer 계정 발급·목록·폐기 Edge Functions | `backend/functions/dealer-tokens-{issue,list,revoke}/index.ts` |
| Admin Dealer 계정 UI (gridge_admin 전용 · 발급 폼·QR·목록·딜러별 응답 수) | `../S_Sensor/admin/app/voice/dealers/page.tsx` |
| voice_dealer_tokens 운영 메타 (label·issued_by) | `../C_Common/supabase/migrations/017_dealer_tokens_meta.sql` |
| 서버 측 deterministic segment 매칭 (R_10.05 미러) | `backend/shared/segments.ts` |
| 공통 helpers (errors·db·hash·env·idempotency·logger) | `backend/shared/*.ts` (S_Sensor 재export) |
| Visitor PWA (단일 HTML · Service Worker · IndexedDB · 옵트인 명함) | `visitor/index.html` · `visitor/sw.js` · `visitor/manifest.webmanifest` |
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
