# PRD-03 플랫폼 — 통합·인프라·하네스 2

> **버전**: v1.0 · **하네스 소스**: `U_Unified/` · `C_Common/` · `R_Runtime/`
> **관련 가설**: H_채널통합 · H_외부컨트롤 · H_하네스2 · H_확장

---

## 0. 목차

| 키워드 | 섹션 |
|---|---|
| 한 줄 본질 | § 1 |
| 기능 요구사항 — U_Unified (통합) | § 2 |
| 기능 요구사항 — C_Common (인프라) | § 3 |
| 기능 요구사항 — R_Runtime (하네스 2) | § 4 |
| 데이터 모델 | § 5 |
| 비기능 요구사항 | § 6 |
| 통과 기준 | § 7 |
| 의존성 | § 8 |

---

## 1. 한 줄 본질

Sensor·Voice 두 채널 → Lead 응집 → LeadScoring → DealerOutput 발급. 인프라 (Supabase 단독) + 하네스 2 (YAML 룰 외부 관리 + hot reload)가 기반.

---

## 2. 기능 요구사항 — U_Unified (통합)

→ `U_Unified/INDEX.md` (U_10·U_20·U_30·U_40)

### U_10 Lead 응집

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| U-001 | leads 테이블 정의 | `U_10.01` | v1 | 0 |
| U-002 | entity_id 기준 Sensor ↔ Voice 매핑 | `U_10.02` | v1 | 0 |
| U-003 | 자동 응집 (upsertLead) | `U_10.03` | v1 | 0 |
| U-004 | unassociated 처리 (entity 없는 데이터) | `U_10.04` | v1 | 1 |
| U-005 | 시간순 타임라인 (Lead 이력) | `U_10.05` | v2 | — |

### U_20 Output (Playbook·Score 발급)

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| U-010 | LeadScoring 적용 (R_10.01) | `U_20.01` | v1 | 0 |
| U-011 | LeadQuality 등급 (R_10.02) | `U_20.02` | v1 | 0 |
| U-012 | Classification (R_10.05) | `U_20.03` | v1 | 0 |
| U-013 | DealerOutput 발급 (R_10.07) | `U_20.04` | v1 | 0 |
| U-014 | LeadPriority P1~P5 표시 | `U_20.05` | v1 | 0 |

### U_30 Admin (통합 뷰)

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| U-020 | Lead 목록 (필터·정렬) | `U_30.01` | v1 | 0 |
| U-021 | Lead 상세 (Sensor + Voice 통합) | `U_30.02` | v1 | 0 |
| U-022 | 채널 통합 표시 (entity·timeline) | `U_30.03` | v1 | 0 |
| U-023 | 점수·등급·우선순위 표시 | `U_30.04` | v1 | 0 |
| U-024 | Dashboard 실시간 알림 | `U_30.05` | v2 | — |

### U_40 Data

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| U-030 | leads 스키마 | `U_40.01` | v1 | 0 |
| U-031 | dealer_outputs 스키마 | `U_40.02` | v1 | 0 |
| U-032 | entity_id 단순 매핑 (v1) | `U_40.03` | v1 | 0 |
| U-033 | Linkage 다대다 테이블 | `U_40.04` | v2 | — |

---

## 3. 기능 요구사항 — C_Common (인프라)

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| C-001 | Supabase 단독 primary + Fly.io fallback | `C_01_Hosting.md` | v1 | 0 |
| C-002 | PostgreSQL + Storage (Supabase 내장) | `C_02_DB.md` | v1 | 0 |
| C-003 | /v1 prefix · cursor pagination · Idempotency | `C_03_API_패턴.md` | v1 | 0 |
| C-004 | 4종 인증 (HMAC·Bearer·Anonymous·Auth) | `C_04_인증.md` | v1 | 0 |
| C-005 | Anthropic 단독 · 비동기 큐 (50s 우회) | `C_05_LLM_정책.md` | v1 | 0 |
| C-006 | 구조화 JSON 로깅 + Prometheus 메트릭 | `C_06_로깅_메트릭.md` | v1 | 0 |
| C-007 | 30일 보관 · PII 익명화 · TLS 1.3 | `C_07_보안_법무.md` | v1 | 0 |
| C-008 | GCP Secret Manager · 환경변수 분리 | `C_08_배포_환경변수.md` | v1 | 0 |
| C-009 | Cloudflare 전면 금지 | `C_01_Hosting.md` + 폐기 § 2.11 | v1 | 0 |

---

## 4. 기능 요구사항 — R_Runtime (하네스 2)

### R_10 룰

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| R-001 | R_10.01 LeadScoring (시드 4 규칙) | `R_10.01 YAML` | v1 | 0 |
| R-002 | R_10.02 LeadQuality (A/B/C/D) | `R_10.02 YAML` | v1 | 0 |
| R-003 | R_10.05 Classification (segment·화면·P1~P5) | `R_10.05 YAML` | v1 | 0 |
| R-004 | R_10.06 PromptTemplates (3 템플릿) | `R_10.06 YAML` | v1 | 0 |
| R-005 | R_10.07 DealerOutput (8 segment Playbook) | `R_10.07 YAML` | v1 | 0 |
| R-006 | R_10.08 SurveyBuildPrompt | `R_10.08 YAML` | v1 | 0 |
| R-007 | R_10.03 MentRecommendation | `R_10.03 YAML` | v2 | — |
| R-008 | R_10.04 SalesTool | `R_10.04 YAML` | v2 | — |
| R-009 | R_10.09 DataPointToQuestion (데이터 포인트 → 질문) | `R_10.09 YAML` | v1 | 0 |

### R_20 도구

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| R-010 | RuleEditor (YAML 편집 UI) | `R_20.01` | v1 | 0 |
| R-011 | Validation (시드 시뮬레이션) | `R_20.02` | v1 | 0 |
| R-012 | Deployment (hot reload + Git commit) | `R_20.03` | v1 | 0 |

### harness2/lib

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| R-020 | YAML 로드 + 캐시 + hot reload (60s TTL) | `lib/load_rules.ts` | v1 | 0 |
| R-021 | 조건 표현식 안전 평가 (eval X) | `lib/evaluator.ts` | v1 | 0 |
| R-022 | applyFullPipeline (Score→Grade→Priority→Segment) | `lib/apply_rules.ts` | v1 | 0 |
| R-023 | extractSensor13Fields (Claude Vision) | `lib/prompt_templates.ts` | v1 | 0 |
| R-024 | renderDealerOutput (Markdown/JSON) | `lib/output_renderer.ts` | v1 | 0 |
| R-025 | buildSurveyFromNL (Studio) | `lib/survey_builder.ts` | v1 | 0 |
| R-026 | scoreCapture + FIELD_WEIGHTS (정확도) | `lib/accuracy_evaluator.ts` | v1 | 0 |

---

## 5. 데이터 모델

| 테이블 | 하네스 참조 |
|---|---|
| leads | `U_40.01` |
| dealer_outputs | `U_40.02` |
| R_10 YAML 8 파일 | `R_Runtime/R_10_Rules/*.yaml` |
| harness2/lib TS 9 파일 | `R_Runtime/lib/*.ts` |

---

## 6. 비기능 요구사항

| ID | 요구사항 | 하네스 참조 |
|---|---|---|
| NF-P01 | hot reload 60s 안 새 룰 적용 | `lib/load_rules.ts` |
| NF-P02 | 서비스 재배포 없이 룰 변경 | `R_20.03` |
| NF-P03 | Lead 응집 자동 (코드 개입 X) | `U_10.03` |
| NF-P04 | CRM-agnostic (CRMDefinition 추가만) | `S_40.02` |

---

## 7. 통과 기준

→ `T_Test/T_06_E2E_통합/INDEX.md` · `T_08.06_하네스2_검증.md`

| 가설 | 기준 |
|---|---|
| H_채널통합 | Sensor + Voice → 같은 Lead 응집 |
| H_외부컨트롤 | 프롬프트 정정 → 정확도 변화 측정 1회+ |
| H_하네스2 | YAML 로드 + hot reload + 외부 사이클 작동 |
| H_확장 | CRMDefinition 설계 완료 (v2 시 코드 변경 없이 CRM 추가) |

---

## 8. 의존성

| 의존 | 제공 방향 |
|---|---|
| S_Sensor → U_Unified | Sensor normalized_fields → leads upsert |
| V_Voice → U_Unified | Voice responses → leads upsert |
| R_Runtime → 전 트랙 | 모든 트랙이 R_10 룰 + harness2/lib 사용 |
| C_Common → 전 트랙 | 인프라 공통 |

---

## 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-13 | v1.0 |
