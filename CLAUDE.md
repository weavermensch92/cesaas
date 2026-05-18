# HD건설기계 PoC — CLAUDE.md (구현 리포지토리 진입점)

> **하네스 1 구현체**. PRD(이 리포 내부)와 하네스(`../../hd-hyundai-poc-harness-v1/`)를 동시 참조하며 구현.
> **버전**: v0.1 (C_Common 인프라 골격)
> **본질**: 러시아 딜러 ↔ HD 본사 영업 깔때기를 AI가 운영 — 11일 PoC 검증.

---

## 0. 이 리포의 본질

이 폴더는 **PRD + 구현 코드**가 같이 사는 자리입니다.

| 자산 | 역할 |
|---|---|
| `PRD/` | 요구사항·통과 기준 (수정은 PRD 변경 절차로) |
| `C_Common/` | 공통 인프라 (Supabase·API 패턴·인증·LLM 큐·R_10 로더·디자인) |
| `S_Sensor/` | Extension MV3 · 백엔드 (수신·정규화·Admin API) · Next.js Admin UI |
| `V_Voice/` | Dealer v3 단일 HTML · 응답 수신 백엔드. Visitor·Admin·Studio 예정 |
| `R_Runtime/` | 하네스 2 — R_10 YAML 시드 (C_Common 측) + R_20 위버 도구(JWT/QR) |
| `U_Unified/` *(예정)* | Lead 응집·LeadScoring·linkage |
| `T_Test/` *(예정)* | 가설 측정·E2E·우회 시나리오 |
| `_preview/` | 백엔드 없이 화면을 한눈에 — 갤러리·dealer·admin mock·extension popup |

> 하네스 규칙·키워드 트리거 원문은 `../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/CLAUDE.md` 에 있습니다. 본 파일은 그 규칙을 코드 리포에 사상한 인덱스입니다.

---

## 1. 호출 규칙 (MUST)

1. **새 파일 만들기 전** — 해당 폴더의 `CLAUDE.md` 부터 읽기 (없으면 상위까지 거슬러 올라가기).
2. **새 API·테이블·컴포넌트** — `C_Common/` 에 정의된 표준(아래 § 4) 그대로.
3. **LLM 호출** — `packages/core/src/llm.ts` + R_10.06 YAML 로드. **하드코드 프롬프트 금지**.
4. **점수/분류/출력** — `R_Runtime/R_10_Rules/*.yaml` 외부 로드.
5. **장애** — 우회 시나리오 우선. "중단" 금지.
6. **금기어** — 모든 코드·주석·UI에서 `hyundai`·`현대` 표기 금지. `HD` 또는 `HD건설기계`. (CI § 4 + 본질 원칙 § 6)
7. **하드코드 지양** — 모든 과정에 하드 코딩은 지양 
8. **목차 활용 압축** - 토큰과 맥락 낭비를 방지하기 위해, 최대한 index들을 활용하여 필요한 자료들만 취하여 300줄 미만으로 맥락을 이해하도록 유지

---

## 2. 디렉토리 트리 (현재)

```
hd-hyundai-poc/
├── CLAUDE.md                          ← 이 파일
├── README.md
├── package.json                       ← workspaces 루트
├── tsconfig.base.json
├── .env.example
├── .gitignore
│
├── PRD/                               PRD 4종 (마스터·Sensor·Voice·플랫폼·검증)
│
└── C_Common/                          공통 인프라 (v0.1 — 골격)
    ├── CLAUDE.md
    ├── supabase/
    │   ├── config.toml
    │   └── migrations/
    │       ├── 001_common.sql
    │       └── 006_idempotency.sql
    ├── packages/
    │   ├── core/                       TS 공유 라이브러리
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   │   └── src/
    │   │       ├── index.ts
    │   │       ├── errors.ts
    │   │       ├── pagination.ts
    │   │       ├── idempotency.ts
    │   │       ├── hmac.ts
    │   │       ├── auth.ts
    │   │       ├── logger.ts
    │   │       ├── rules.ts
    │   │       └── llm.ts
    │   └── design/                     hd-design CSS·i18n 패키지
    │       ├── package.json
    │       └── src/
    │           ├── index.ts
    │           ├── styles/
    │           │   ├── colors_and_type.css
    │           │   └── styles.css
    │           └── i18n/
    │               └── index.ts
    └── r_10_rules/                     R_10 YAML 스텁 (R_Runtime 이관 예정)
        ├── R_10.01_LeadScoring.yaml
        ├── R_10.05_Classification.yaml
        ├── R_10.06_PromptTemplates.yaml
        ├── R_10.07_DealerOutput.yaml
        └── R_10.08_SurveyBuildPrompt.yaml
```

---

## 3. 키워드 → 위치 트리거

| 키워드 | 위치 |
|---|---|
| Supabase·마이그레이션·Storage·스키마 | `C_Common/supabase/` |
| API 에러 포맷·cursor·idempotency | `C_Common/packages/core/src/{errors,pagination,idempotency}.ts` |
| HMAC·Bearer·Anonymous·Supabase Auth | `C_Common/packages/core/src/{hmac,auth}.ts` |
| 구조화 JSON 로깅·request_id | `C_Common/packages/core/src/logger.ts` |
| LLM·Anthropic·backoff·rate limit | `C_Common/packages/core/src/llm.ts` |
| R_10 YAML·hot reload | `C_Common/packages/core/src/rules.ts` · `C_Common/r_10_rules/` |
| 디자인 토큰·CI 컬러·타이포 | `C_Common/packages/design/src/styles/` |
| 다국어 ko·ru·en | `C_Common/packages/design/src/i18n/` |

---

## 4. 핵심 코드 컨벤션 (전 모듈 일관)

### 4.1 API

- `/v1` prefix
- JSON error: `{ error: "code", message: "human", details: {} }` — `core/errors.ts`
- Cursor pagination — `core/pagination.ts`
- `Idempotency-Key` 헤더 — `core/idempotency.ts`
- docstring(JSDoc) 표준:

  ```ts
  /**
   * serves: ['dealer']
   * direction: 'upward'
   * related_hypothesis: ['H1']
   * harness: 1
   */
  ```

### 4.2 데이터 모델

- 공통 컬럼: `id`·`created_at`·`updated_at`·`crm_id`·`region`·`version`·`lead_id`(nullable)·`entity_id`·`source`·`direction`
- 마이그레이션은 INSERT 전용 (수정은 새 row + reversal)

### 4.3 컴포넌트 분리

- `gridge_core/` (재사용) vs `hd_specific/` (HD 특수). 패키지 분리는 v2에서 본격.
- v1에서는 디렉토리 prefix(`hd-` / `gridge-`)로 분리 의도 표시.

### 4.4 인증 4종

| 사용처 | 방식 | 위치 |
|---|---|---|
| Extension | HMAC + API key | `core/hmac.ts` · `core/auth.ts#verifyHmac` |
| Dealer | Bearer JWT | `core/auth.ts#verifyBearer` |
| Visitor | Anonymous (device_id) | `core/auth.ts#extractDeviceId` |
| Admin | Supabase Auth | `core/auth.ts#requireAdmin` |
| 위버 R_20 | Basic + IP allowlist | `R_Runtime/` (예정) |

### 4.5 LLM

- Anthropic 단독 · 모델 `claude-opus-4-7` (Sensor 정규화 / Studio)
- 호출 위치: 한국 서버 (Supabase Edge Function 또는 Fly.io)
- 비동기 큐: `captures.status = 'pending_normalize'` → pg_cron → worker function
- 프롬프트는 R_10.06 YAML에서 로드 (`core/rules.ts`)
- 지수 백오프 (1·2·4·8·16s, max 5회)

### 4.6 호스팅

- Primary: Supabase Tokyo (`ap-northeast-1`)
- Fallback: Fly.io `nrt`
- 금지: Cloudflare 전부, Vercel custom domain

---

## 5. 다음 진행 영역

| 영역 | 상태 |
|---|---|
| C_Common 골격 (core·design·migrations 001/006·R_10 시드) | ✓ v0.1 |
| S_Sensor Extension MV3 (러시아) | ✓ v0.1 |
| S_Sensor Backend (수신·합성·분류·클러스터) | ✓ v0.2 |
| S_Sensor normalize-worker (Claude Vision 13 필드) | ✓ v0.3 |
| S_Sensor Admin Next.js + Edge Functions 4종 | ✓ v0.4 |
| V_Voice Dealer v3 단일 HTML + 응답 수신 | ✓ v0.1 |
| R_20 Dealer JWT 발급 CLI + QR | ✓ v0.1 |
| _preview 갤러리 | ✓ v0.1 |
| V_Voice Visitor PWA · Admin · Studio | 다음 라운드 |
| U_Unified Lead 응집·LeadScoring | 다음 라운드 |
| T_Test E2E·가설 측정 | 다음 라운드 |

---

## 6. 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-18 | v0.1 — C_Common 골격 (Supabase 마이그레이션·core 라이브러리·디자인 패키지·R_10 YAML 스텁) |
| 2026-05-18 | v0.2~0.5 — S_Sensor 풀(Extension·Backend·normalize-worker·Admin UI), V_Voice Dealer 단일 HTML + 응답 수신, R_20 토큰 CLI, _preview 갤러리 |
