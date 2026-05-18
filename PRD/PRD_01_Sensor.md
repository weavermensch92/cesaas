# PRD-01 Sensor — CRM 자동 캡쳐·정규화

> **버전**: v1.0 · **하네스 소스**: `S_Sensor/`
> **관련 가설**: H1 · H2 · H3 · H_LLM · H_도달성

---

## 0. 목차

| 키워드 | 섹션 |
|---|---|
| 한 줄 본질 | § 1 |
| 기능 요구사항 — Extension | § 2 |
| 기능 요구사항 — Backend | § 3 |
| 기능 요구사항 — LLM | § 4 |
| 기능 요구사항 — Admin | § 5 |
| 데이터 모델 | § 6 |
| 비기능 요구사항 | § 7 |
| 통과 기준 | § 8 |
| 의존성 | § 9 |

---

## 1. 한 줄 본질

Chrome Extension이 Bitrix24 화면 자동 캡쳐 → 한국 서버 전송 → Claude Vision 정규화 → 13 필드 DB 적재 → Admin 검토·편집·재정규화.

→ `S_Sensor/CLAUDE.md`

---

## 2. 기능 요구사항 — Extension (러시아)

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| S-001 | Manifest V3 · 최소 permissions | `S_10.01 § 2~3` | v1 | 0 |
| S-002 | CRMDefinition URL 매칭 (분류 X) | `S_10.02 § 2~3` | v1 | 0 |
| S-003 | SPA pushState 라우팅 감지 | `S_10.02 § 5` | v1 | 0 |
| S-004 | WebP 캡쳐 (quality 0.85) + 메타 부착 | `S_10.03 § 2~4` | v1 | 0 |
| S-005 | 캡쳐 크기 500KB 초과 시 quality 자동 ↓ | `S_10.03 § 6` | v1 | 0 |
| S-006 | 16KB 청크 분할 + HMAC 서명 | `S_10.04 § 3~4` | v1 | 0 |
| S-007 | 재시도 8회 지수 백오프 | `S_10.04 § 5` | v1 | 0 |
| S-008 | Idempotency-Key 청크별 | `S_10.04 § 6` | v1 | 0 |
| S-009 | IndexedDB 오프라인 큐 1000건 | `S_10.05 § 2~4` | v1 | 0 |
| S-010 | online 이벤트 자동 drain | `S_10.05 § 5` | v1 | 0 |
| S-011 | popup UI (큐 상태·재시도·로그 export) | `S_10.06 § 4` | v1 | 0 |
| S-012 | 백엔드 메트릭 보고 (일별) | `S_10.06 § 5` | v1 | 1 |
| S-013 | 스크롤 잘림 대응 (multi-image 보완) | `S_10.03 § 7` | v1 | 1 |
| S-014 | 스크롤 후 재캡쳐 | `S_10.03 § 7` | v2 | — |

---

## 3. 기능 요구사항 — Backend (한국)

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| S-020 | `/v1/captures/chunks` 청크 수신 + Storage 임시 | `S_20.01 § 3` | v1 | 0 |
| S-021 | `/v1/captures/finalize` 합성 + hash 검증 | `S_20.01 § 3` | v1 | 0 |
| S-022 | HMAC 검증 (timestamp 5분 drift · nonce) | `S_20.01 § 4` | v1 | 0 |
| S-023 | Idempotency 24h (processed_events) | `S_20.01 § 5` | v1 | 0 |
| S-024 | URL regex 1차 분류 (R_10.05) | `S_20.02 § 3` | v1 | 0 |
| S-025 | LLM 보조 2차 분류 (R_10.06.003) | `S_20.02 § 4` | v1 | 1 |
| S-026 | entity_id URL 추출 | `S_20.02 § 5` | v1 | 0 |
| S-027 | EntityCluster 묶음 (같은 entity) | `S_20.03 § 3` | v1 | 0 |
| S-028 | 5장 선택 (시간순 + 다양화) | `S_20.03 § 4~5` | v1 | 0 |
| S-029 | 정규화 비동기 큐 (pg_cron + pg_net) | `S_20.04 § 3~4` | v1 | 0 |
| S-030 | 큐 lock + 재시도 3회 + 우선순위 | `S_20.04 § 4~5` | v1 | 0 |
| S-031 | normalized_fields upsert + supersede | `S_20.05 § 2~3` | v1 | 0 |
| S-032 | version 추적 (prompt_version) | `S_20.05 § 4` | v1 | 0 |
| S-033 | Admin API (목록·상세·재정규화 트리거) | `S_20.06 § 2~5` | v1 | 0 |

---

## 4. 기능 요구사항 — LLM

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| S-040 | Claude Vision 단독 (claude-opus-4-7) | `S_30.01` | v1 | 0 |
| S-041 | 13 필드 추출 (R_10.06.001) | `S_30.02` | v1 | 0 |
| S-042 | multi-image 5장 입력 | `S_30.03` | v1 | 0 |
| S-043 | 429·5xx 지수 백오프 | `S_30.04` | v1 | 0 |
| S-044 | Token 카운팅 + 비용 메트릭 | `S_30.05` | v1 | 1 |
| S-045 | 비용 월 한도 80% 알림 | `S_30.05 § 4` | v1 | 1 |

---

## 5. 기능 요구사항 — Admin

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| S-050 | 캡쳐 목록 (필터·정렬·cursor) | `S_50.01` | v1 | 0 |
| S-051 | 정규화 결과 (13 필드 + confidence) | `S_50.02 § 2~3` | v1 | 0 |
| S-052 | 필드 수동 편집 + audit | `S_50.03` | v1 | 0 |
| S-053 | 재정규화 트리거 (단건·일괄) | `S_50.04` | v1 | 0 |
| S-054 | 이미지 뷰어 (클러스터 5장) | `S_50.05` | v1 | 0 |
| S-055 | 추출 영역 하이라이트 | `S_50.05 § 4` | v2 | — |

---

## 6. 데이터 모델

| 테이블 | 하네스 참조 |
|---|---|
| captures | `S_40.01_captures_schema.md` |
| crm_definitions | `S_40.02_CRMDefinition.md` |
| entity_clusters | `S_40.03_EntityCluster.md` |
| normalized_fields | `S_40.04_normalized_fields.md` |
| 공통 컬럼 | `S_40.05_공통_컬럼.md` |
| 인덱스 정책 | `S_40.06_인덱스.md` |

---

## 7. 비기능 요구사항

| ID | 요구사항 | 하네스 참조 |
|---|---|---|
| NF-S01 | 러시아 4 노드 200 OK | `T_01.01` |
| NF-S02 | 캡쳐 → DB 전체 < 30초 | `T_04.01 § 4` |
| NF-S03 | LLM 정규화 < 50초 (Edge Function 한도) | `S_20.04 § 2` |
| NF-S04 | 오프라인 → 온라인 큐 자동 100% | `S_10.05 § 5` |
| NF-S05 | PII 익명화 (30일 보관) | `C_Common/C_07_보안_법무.md` |

---

## 8. 통과 기준

→ `T_Test/T_02_H1_측정/T_02.04_통과_판정.md` · `T_04_E2E_Sensor/T_04.05_정확도.md`

| 가설 | 기준 |
|---|---|
| H1 | 성공률 ≥ 98% · 7/7 화면 · P95 ≤ 5초 |
| H2 | 1 고객 1주 ≥ 5건 |
| H3 | 정규화 시도 100% (모든 클러스터) |
| H_LLM | multi-image 정확도 측정 (v1 시도) |

---

## 9. 의존성

| 의존 | 제공자 |
|---|---|
| Supabase Edge Functions | `C_Common/C_01_Hosting.md` |
| Anthropic API key | `C_Common/C_05_LLM_정책.md` |
| R_10 룰 YAML | `R_Runtime/R_10_Rules/` |
| harness2/lib | `R_Runtime/lib/` |

---

## 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-13 | v1.0 |
