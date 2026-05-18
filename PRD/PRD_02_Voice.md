# PRD-02 Voice — 설문 수집·Playbook·Studio

> **버전**: v1.0 · **하네스 소스**: `V_Voice/`
> **관련 가설**: V_가설

---

## 0. 목차

| 키워드 | 섹션 |
|---|---|
| 한 줄 본질 | § 1 |
| 기능 요구사항 — Dealer | § 2 |
| 기능 요구사항 — Visitor | § 3 |
| 기능 요구사항 — Admin | § 4 |
| 기능 요구사항 — Backend | § 5 |
| 기능 요구사항 — Studio | § 6 |
| 데이터 모델 | § 7 |
| 비기능 요구사항 | § 8 |
| 통과 기준 | § 9 |
| 의존성 | § 10 |

---

## 1. 한 줄 본질

부스에서 Dealer가 고객 인터뷰 (31문항) → 8 segment 자동 매칭 → Playbook 즉시 발급. Visitor는 QR 진입 18문항 자가 응답. Studio가 자연어로 설문 자동 생성.

→ `V_Voice/CLAUDE.md`

---

## 2. 기능 요구사항 — Dealer

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| V-001 | v3 단일 HTML (CDN 없음·오프라인) | `V_10.01 § 2` | v1 | 0 |
| V-002 | 6 axis 인터뷰 입력 (큰 버튼 터치) | `V_10.02` | v1 | 0 |
| V-003 | R_10.05 클라이언트 segment 매칭 | `V_10.03 § 3` | v1 | 0 |
| V-004 | segment 매칭 안 됨 → LLM 보조 (서버) | `V_10.03 § 4` | v1 | 1 |
| V-005 | NPS (0~10) 필수 | `V_10.04 § 3` | v1 | 0 |
| V-006 | 향후 수신 동의 필수 | `V_10.04 § 5` | v1 | 0 |
| V-007 | 마케팅 7질문 (Q1~Q7) | `V_10.04 § 4` | v1 | 0 |
| V-008 | Playbook 즉시 발급 (클라이언트 R_10.07) | `V_10.05 § 2~3` | v1 | 0 |
| V-009 | 서버 Playbook 갱신 (LeadScoring 후) | `V_10.05 § 4` | v1 | 0 |
| V-010 | 멘트 표시 (v1 pitch_examples) | `V_10.06 § 2` | v1 | 0 |
| V-011 | 멘트 LLM 동적 생성 | `V_10.06 § 3` | v2 | — |
| V-012 | LeadPriority 아이콘·라벨 (P1~P5) | `V_10.06 § 4` | v1 | 0 |
| V-013 | POST /v1/responses + Bearer + Idempotency | `V_10.07 § 2~5` | v1 | 0 |
| V-014 | 오프라인 큐 → 자동 drain | `V_10.07 § 4` | v1 | 0 |
| V-015 | 언어 토글 (ru·en·ko) | `V_10.01 § 5` | v1 | 1 |

---

## 3. 기능 요구사항 — Visitor

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| V-020 | PWA (manifest + Service Worker) | `V_20.01` | v1 | 0 |
| V-021 | 18문항 (필수 12 + 선택 6) | `V_20.02 § 2` | v1 | 0 |
| V-022 | 4 핵심 axis 필수 (segment 분류 최소) | `V_20.03 § 2` | v1 | 0 |
| V-023 | NPS + 동의 필수 | `V_20.03 § 3~4` | v1 | 0 |
| V-024 | 연락처 옵트인 (선택 후 표시) | `V_20.04 § 2` | v1 | 0 |
| V-025 | 익명 응답 (device_id) | `V_20.05 § 2` | v1 | 0 |
| V-026 | Bot 방지 (hCaptcha 또는 honeypot) | `V_20.05 § 3` | v1 | 1 |
| V-027 | 오프라인 큐 (IndexedDB + Sync) | `V_20.06` | v1 | 0 |
| V-028 | 결과 카드 (segment + 카탈로그 QR) | `V_20.07` | v1 | 0 |
| V-029 | 소요 시간 필수 ≤ 2분 | `V_20.02 § 4` | v1 | 0 |

---

## 4. 기능 요구사항 — Admin

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| V-030 | 응답 목록 (필터·정렬·cursor) | `V_30.01` | v1 | 0 |
| V-031 | 응답 상세 (6 axis 레이더 + NPS) | `V_30.02` | v1 | 0 |
| V-032 | 집계 (segment 카운트·NPS 분포) — Insight v0 | `V_30.03` | v1 | 0 |
| V-033 | CSV export (PII 익명화 토글) | `V_30.04` | v1 | 0 |
| V-034 | 상태 모니터 (실시간 응답률·에러) | `V_30.05` | v1 | 1 |

---

## 5. 기능 요구사항 — Backend

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| V-040 | POST /v1/responses (Dealer Bearer · Visitor Anonymous) | `V_40.01` | v1 | 0 |
| V-041 | Request 검증 (필수·스키마) | `V_40.02` | v1 | 0 |
| V-042 | responses + response_answers 분리 저장 | `V_40.03 § 2` | v1 | 0 |
| V-043 | segment 자동 분류 트리거 (R_10.05) | `V_40.03 § 3` | v1 | 0 |
| V-044 | Admin 조회 API (목록·상세·집계·CSV) | `V_40.04` | v1 | 0 |
| V-045 | 설문 정의 조회 API (다국어) | `V_40.05` | v1 | 0 |

---

## 6. 기능 요구사항 — Studio (v1 신설)

| ID | 요구사항 | 하네스 참조 | v1/v2 | P |
|---|---|---|---|---|
| V-060 | 자연어 입력 UI | `V_60.01` | v1 | 0 |
| V-061 | LLM 빌드 (R_10.08 SurveyBuildPrompt) | `V_60.02` | v1 | 0 |
| V-062 | 검토·편집 UI (문항 CRUD + 미리보기) | `V_60.03` | v1 | 0 |
| V-063 | 배포 (DB INSERT + Dealer·Visitor 자동 적용) | `V_60.04` | v1 | 0 |
| V-065 | 데이터 추적 모드 (DataPoint → 질문 변환 · R_10.09) | `V_60.05` · `R_10.09` | v1 | 0 |

---

## 7. 데이터 모델

| 테이블 | 하네스 참조 |
|---|---|
| surveys | `V_50.06 § 1` |
| survey_questions | `V_50.06 § 2` |
| responses | `V_50.06 § 3` |
| response_answers | `V_50.06 § 4` |
| 6 axis 정의 | `V_50.01` |
| 8 segment 정의 | `V_50.02` |
| 7 질문 | `V_50.03` |
| 다국어 | `V_50.07` |

---

## 8. 비기능 요구사항

| ID | 요구사항 | 하네스 참조 |
|---|---|---|
| NF-V01 | Dealer 오프라인 완전 작동 | `V_10.01 § 4` |
| NF-V02 | Visitor PWA 로드 < 3초 (캐시) | `V_20.01 § 3` |
| NF-V03 | Visitor 필수 12문항 ≤ 2분 | `V_20.02 § 4` |
| NF-V04 | Playbook 표시 < 1초 (클라이언트) | `V_10.05 § 3` |
| NF-V05 | 3 언어 (ru·en·ko) | `V_50.07` |

---

## 9. 통과 기준

→ `T_Test/T_05_E2E_Voice/INDEX.md`

| 시나리오 | 기준 |
|---|---|
| Dealer E2E | 31문항 → Playbook 즉시 |
| Visitor E2E | 18문항 + 오프라인 큐 |
| Admin | 집계·CSV 작동 |
| Studio | 자연어 → 설문 → 배포 |
| 출장 시연 | 부스 동시 운영 (T_05.05) |

---

## 10. 의존성

| 의존 | 제공자 |
|---|---|
| R_10.05 Classification | `R_Runtime/R_10_Rules/` |
| R_10.07 DealerOutput | `R_Runtime/R_10_Rules/` |
| R_10.08 SurveyBuildPrompt | `R_Runtime/R_10_Rules/` |
| harness2/lib | `R_Runtime/lib/` |
| Supabase Auth | `C_Common/C_04_인증.md` |

---

## 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-13 | v1.0 |
