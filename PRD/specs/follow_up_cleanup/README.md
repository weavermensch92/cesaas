# 후속 정리 — DW 6축 도입(2026-05-21) 후 미완 영역

> **상위**: `../../README.md` · `../../../CLAUDE.md`
> **버전**: v1 (2026-05-22)
> **본질**: PR #5·#6·#7·#8 머지로 DW 6축 인프라(R_10.10 rule + 031 columns + 032 survey swap)가 prod 배포된 후 남은 4개 영역의 사양·우선순위·의존 그래프.

---

## 0. 목차

| 키워드 | 섹션 |
|---|---|
| TL;DR | § 1 |
| 우선순위 매트릭스 | § 2 |
| 항목 1 — Edge Functions 배포 검증·정리 | § 3 |
| 항목 2 — DW 백엔드 와이어링 (간접 추론 산출) | § 4 |
| 항목 3 — Visitor PWA DW 6축 적용 | § 5 |
| 항목 4 — Admin DW 시각화 | § 6 |
| 작업 순서 (DAG) | § 7 |
| 외부 의존 자산 (HD 인사이트) | § 8 |
| 변경 이력 | § 9 |

---

## 1. TL;DR

| # | 카테고리 | P | 한 줄 |
|---|---|---|---|
| 1 | Edge Functions 배포 | P0 | deploy.yml ↔ 파일 시스템 정합 검증 자동화 |
| 2 | DW 백엔드 와이어링 | P1 | `computeDw()` 구현 + responses-receive 분기 + LeadScoring 가산 활성 |
| 3 | Visitor PWA DW | P2 | survey_v1_visitor에 DW 6축 추가 + radar 컴포넌트 |
| 4 | Admin 시각화 | P1 | voice-aggregates에 평균 DW 추가 + Admin radar overlay |

**현재 prod 상태 (2026-05-22 기준)**:
- ✓ Dealer v2 [/dealer/v2](../../../V_Voice/dealer/v2/index.html)는 클라이언트 측에서 6축 Likert 평균 → `preference_axes`(1~5) 직접 송출 (작동)
- ✓ R_10.10 rule이 `rule_versions` 테이블에 active로 시드 ([031](../../../C_Common/supabase/migrations/031_dw_indirect_inference.sql))
- ✓ R_10.01 v1.1 (`dw_alignment_bonus`)도 시드됨 — 단 입력 캐시 미생성(`leads.dw_alignment` NULL)
- ✗ `computeDw()` 산출 함수 미구현 → 간접 추론 경로 무작동
- ✗ Visitor PWA에 DW 6축 0
- ✗ Admin UI에 DW radar 0

---

## 2. 우선순위 매트릭스

| 항목 | P | 영향 | 의존 | 예상 LOC |
|---|---|---|---|---|
| 1 Edge Functions 검증 | P0 | 배포 안정성 (다음 cleanup PR이 안전하게 머지될 수 있게) | 없음 | ~50 (script) |
| 2 DW 백엔드 와이어링 | P1 | DW 산출이 실제로 작동 → LeadScoring R_10.01.005 활성 | 1 | ~250 (lib + handler + scoreLead) |
| 3 Visitor PWA DW | P2 | Visitor 데이터도 DW 자산화 | 2 | ~150 (migration + UI) |
| 4 Admin 시각화 | P1 | HD 운영자가 DW 패턴 인지 (출장 인사이트 입력) | 2 | ~200 (aggregates + radar) |

P0: 출장 전 (5/23~5/25). P1: 출장 후 (5/30~6/2). P2: 시연 검증 후 (6/3~).

---

## 3. 항목 1 — Edge Functions 배포 검증·정리

### 3.1 현황
- 2026-05-21 deploy-prod run 26246203845 [Deploy Edge Functions 로그](https://github.com/weavermensch92/cesaas/actions/runs/26246203845):
  ```
  Bundling Function: admin-llm-usage
  WARN: failed to read file: ...admin-llm-usage/index.ts: no such file or directory
  Error: entrypoint path does not exist (supabase/functions/admin-llm-usage/index.ts)
  ```
- 이후 main grep 결과 — 실파일 존재 (위 에러 시점 이후 별도 정리됐을 가능성)
- 단 **확정 검증 안 됨** — 다음 deploy 시 다시 같은 에러로 후속 함수 미배포 가능

### 3.2 변경
- **신규**: `scripts/verify-functions.sh` — [.github/workflows/deploy.yml](../../../.github/workflows/deploy.yml#L57-L100)의 `supabase functions deploy` 명령에서 함수 이름 추출 → 각 함수에 대응하는 `{S_Sensor|V_Voice|U_Unified|T_Test}/backend/functions/<name>/index.ts` 실재 확인 → 누락 1개라도 있으면 exit 1
- **`.github/workflows/deploy.yml`** — `typecheck` 잡 후 `verify-functions` 잡 추가, `deploy-prod`/`deploy-staging`/`deploy-admin-fly`가 `needs`에 포함
- (선택) PR 시점에도 검증되도록 push 트리거 추가

### 3.3 의존성
없음.

### 3.4 통과 기준
- `bash scripts/verify-functions.sh` 종료 코드 0
- deploy-prod step에서 Edge Functions 전체 배포 성공 (이전 PR #8 실행 시 admin-llm-usage에서 실패했던 패턴 재현 안 됨)
- deploy.yml에 함수 이름 추가 시 파일 없으면 PR CI에서 즉시 fail

### 3.5 위험
- 함수 이름 파싱 정규식 — 다중 `supabase functions deploy` 명령에서 cli 옵션과 함수명 구분 필요. test fixture로 테스트.

---

## 4. 항목 2 — DW 백엔드 와이어링 (간접 추론 산출 함수)

### 4.1 현황

| 자산 | 상태 |
|---|---|
| R_10.10 룰 YAML in `rule_versions` | ✓ active ([031](../../../C_Common/supabase/migrations/031_dw_indirect_inference.sql)) |
| R_10.01 v1.1 (R_10.01.005) | ✓ active ([031](../../../C_Common/supabase/migrations/031_dw_indirect_inference.sql)) |
| `responses.dw_raw_answers·dw_extraction` 컬럼 | ✓ 추가됨 |
| `leads.dw_alignment` 컬럼 | ✓ 추가됨, 값은 NULL |
| `computeDw()` lib 함수 | ✗ 미구현 |
| `responses-receive` handler가 dw_raw_answers 수신 | ✗ 페이로드 입력점 없음 |
| `scoreLead`가 R_10.10·hd_strength 적용 | ✗ R_10.01·.02·.05만 로드 |
| Dealer v2 간접질문 Q3'~Q8' UI | ✗ 직접 1~5 Likert만 |

Dealer v2 ([V_Voice/dealer/v2/index.html:783-817](../../../V_Voice/dealer/v2/index.html#L783-L817))의 payload:
```js
preference_axes,                   // 클라이언트 6축 평균 1~5 — 작동 중
dealer_hypothesis_segment: state.segment,
// dw_raw_answers, dw_extraction 필드 없음
```

`responses-receive` ([V_Voice/backend/functions/responses-receive/handler.ts](../../../V_Voice/backend/functions/responses-receive/handler.ts)) 는 `preference_axes`만 전달.

### 4.2 변경

#### 4.2.1 lib 신설 — `computeDw()`

위치: `C_Common/packages/core/src/decision_weight.ts`

```typescript
export interface DWInput {
  q3_prime?: 'A'|'B'|'C'|'D'|'E';
  q4_prime?: Array<'A'|'B'|'C'|'D'>;
  q5_prime?: 'A'|'B'|'C'|'D'|'E'|'F';
  q6_prime?: 'A'|'B'|'C'|'D';
  q7_prime?: Array<'A'|'B'|'C'|'D'>;
  q8_prime?: string;
}

export interface DWResult {
  dw_normalized: Record<DWAxis, number>;   // 0~1
  preference_axes: Record<DWAxis, number>; // 1~5
  dw_extraction: {
    method: 'rule' | 'rule+llm' | 'rule_only_low_llm_confidence';
    rule_version: string;
    llm_run_id: string | null;
    llm_confidence: number | null;
  };
}

export function computeDw(input: DWInput, weightMatrix: WeightMatrix): DWResult;
```

산출식 (R_10.10.001~005):
1. 각 질문의 선택 보기 가중치 추출 (multi-select은 평균)
2. `dw_normalized[axis] = Σ(weight) / max(count, 1)`
3. 누락 prior 0.5
4. `clamp [0, 1]`
5. `preference_axes[axis] = clamp(1 + round(4 × dw_normalized[axis]), 1, 5)`

매트릭스 출처: R_10.10 룰 YAML의 `weight_matrix` 절. 로더는 [C_Common/packages/core/src/rules.ts](../../../C_Common/packages/core/src/rules.ts)의 `loadRule()` 재사용.

#### 4.2.2 responses-receive handler 확장

위치: [V_Voice/backend/functions/responses-receive/handler.ts](../../../V_Voice/backend/functions/responses-receive/handler.ts)

```typescript
const payload = await req.json();

let preferenceAxes = payload.preference_axes;
let dwRawAnswers = payload.dw_raw_answers ?? null;
let dwExtraction = null;

if (!preferenceAxes && dwRawAnswers) {
  // 간접 추론 모드
  const { body: r1010 } = await loadRule('R_10.10_DecisionWeight');
  const result = computeDw(dwRawAnswers, r1010.weight_matrix);
  preferenceAxes = result.preference_axes;
  dwExtraction = result.dw_extraction;
}
// 직접 모드 (preferenceAxes != null) → 그대로 사용. dwExtraction = null.

await db.rpc('save_response', {
  // ... 기존 필드 ...
  p_preference_axes: preferenceAxes,
  p_dw_raw_answers: dwRawAnswers,
  p_dw_extraction: dwExtraction,
});
```

`save_response` RPC 시그니처에 `p_dw_raw_answers` + `p_dw_extraction` 추가 — 마이그레이션 034 신설:
```sql
-- 034_save_response_dw_args.sql
CREATE OR REPLACE FUNCTION save_response(..., 
  p_dw_raw_answers JSONB DEFAULT NULL,
  p_dw_extraction JSONB DEFAULT NULL
) ...
```

#### 4.2.3 dealer/v2 간접질문 UI (토글)

위치: [V_Voice/dealer/v2/index.html](../../../V_Voice/dealer/v2/index.html)

좌측 패널(`#dealer_profile`)에 모드 토글:
- **직접 (기본)** — 기존 6축 1~5 Likert (현행 유지)
- **간접 인터뷰** — Q3'~Q7' 단일·다중 선택 + Q8' textarea

토글 ON 시:
- payload에 `dw_raw_answers: { q3_prime, q4_prime, q5_prime, q6_prime, q7_prime, q8_prime }` 채움
- `preference_axes`는 보내지 않음 (서버에서 산출)
- 라더는 서버 산출 결과를 응답 후 갱신 (또는 클라이언트에서 `computeDw()` 미리 실행해 즉시 갱신 — `C_Common/packages/core/src/decision_weight.ts`를 inline 번들로 노출)

UI 시안:
```
┌─ Mode ─────────────────────┐
│ ● 직접 (6 Likert)          │
│ ○ 간접 (인터뷰 5+1)        │
└────────────────────────────┘

[간접 모드 활성 시]
┌─ Q3' 가장 큰 운영 이슈 ────┐
│ ○ 연료비 부담               │
│ ● 잦은 다운타임             │
│ ...                         │
└────────────────────────────┘
(Q4'~Q8' 동일 패턴)
```

#### 4.2.4 LeadScoring R_10.01.005 활성

위치: [V_Voice/backend/shared/lead_scoring.ts](../../../V_Voice/backend/shared/lead_scoring.ts)

`scoreLead()` 함수에 R_10.01 로드 시 v1.1 스키마(R_10.01.005 + hd_strength_matrix) 사용:

```typescript
const { body: r1001 } = await loadRule('R_10.01_LeadScoring');
// 기존 4 규칙 적용 후
if (response.preference_axes && lead.segment) {
  const hdStrength = r1001.hd_strength_matrix?.[lead.segment];
  if (hdStrength) {
    const normalized = Object.fromEntries(
      Object.entries(response.preference_axes).map(([k, v]) => [k, (Number(v) - 1) / 4])
    );
    const alignment = sumDot(normalized, hdStrength);  // 0~6
    const bonus = Math.max(0, Math.min(15, Math.round(alignment * 2.5)));
    score += bonus;
    leadUpdates.dw_alignment = alignment;
  }
}
```

`leads.dw_alignment` 캐시 저장 — Admin radar/table에서 색상 표시 (항목 6.2.3).

### 4.3 의존성
- 항목 4.2.4가 작동하려면 응답 시 `preference_axes`가 채워져야 함 — Dealer v2 직접 모드(이미 작동) 또는 4.2.2 산출 경로 필요
- Visitor도 `preference_axes` 채우려면 항목 3 완료 필요

### 4.4 통과 기준
- Dealer v2 간접 모드 ON 응답 1건 → `responses.dw_raw_answers`·`preference_axes`·`dw_extraction.method = 'rule'` 저장
- 직접 모드 응답 → 기존 동작 그대로 (`dw_extraction = null`)
- LeadScore 산출 시 5 규칙 모두 반영 (NPS·segment+활동·향후수신·거래액·DW alignment)
- `leads.dw_alignment` REAL 값 채워짐 (응답 시점)

### 4.5 위험
- 클라이언트 inline 번들 — `C_Common/packages/core/src/decision_weight.ts`를 단일 HTML에 inline 하려면 빌드 단계 필요. v1엔 직접 모드 유지, 간접은 서버 산출만 (응답 후 라더 갱신)
- LLM 보조(Q8') 비동기 큐는 본 PR 범위 외 — v1.2로 위임

---

## 5. 항목 3 — Visitor PWA DW 6축 적용

### 5.1 현황
- 시드 ([009_voice_visitor.sql](../../../C_Common/supabase/migrations/009_voice_visitor.sql)): 18문항 — 4 기본 axis(scale·usage·fleet_size·decision_role) + 2 상세 axis(annual_operating_hours·annual_deal_rub) + 비축 12문항 (만족·계획·NPS·동의·연락처)
- **DW 6축 입력 0**
- [V_Voice/visitor/index.html](../../../V_Voice/visitor/index.html) 라더 컴포넌트 **없음** — 결과 카드 segment chip만

### 5.2 변경

#### 5.2.1 시드 마이그레이션 033 (visitor DW swap)

위치: `C_Common/supabase/migrations/033_visitor_dw_axes_swap.sql`

패턴: 032와 동일.
- 기존 4 axis 질문(scale·usage·fleet_size·decision_role)의 `axis = NULL`
- DW 6 신규 질문 INSERT (`axis ∈ {price, fuel, durability, service, reference, versatility}`, type=scale_1_5, sort_order 100~105)

**옵션 — visitor는 짧은 응답 시간 필요**: 6축 중 핵심 3축만 (price·fuel·durability) 적용도 고려. v1엔 6축 풀로 시작, completion rate 측정 후 3축으로 축소 검토.

#### 5.2.2 visitor/index.html 확장

- 6 Likert step 추가 (단계별 또는 한 화면 6 카드)
- 라더 컴포넌트 추가 — [V_Voice/dealer/v2/index.html](../../../V_Voice/dealer/v2/index.html#L475-L530)의 `renderRadar()` 직접 포팅 (외부 라이브러리 의존 없음)
- payload에 `preference_axes` 추가 (dealer v2 패턴 동일)

#### 5.2.3 응답 시간 영향 측정

- v1엔 6축 풀
- T_05 측정 시 completion rate 추적
- < 70% 시 v1.1엔 3축으로 축소

### 5.3 의존성
- 항목 2 (responses-receive가 visitor preference_axes도 동일 처리)

### 5.4 통과 기준
- Visitor 응답 1건 → `responses.preference_axes` 6 키 채워짐
- [V_Voice/visitor/index.html](../../../V_Voice/visitor/index.html) 라더가 DW 6축 표시
- 응답 완료율 ≥ 70% (PoC 기준)

### 5.5 위험
- Visitor completion rate 급락 — 6축 추가로 12 필수 → 18 필수
- 회복 옵션: 3축 핵심 (price·fuel·durability)으로 축소
- 라더 시각화가 visitor에게 과한 정보일 수 있음 — segment chip만 노출하고 radar는 admin 측에서만 보는 옵션도 가능

---

## 6. 항목 4 — Admin DW 시각화

### 6.1 현황
- [voice-aggregates 함수](../../../V_Voice/backend/functions/voice-aggregates/index.ts): segment 카운트·NPS 평균만 반환, **preference_axes 평균 0**
- [Admin 페이지](../../../S_Sensor/admin/app/voice/aggregates/page.tsx): KPI 카드·segment bar만, **라더 0**
- [admin-leads](../../../U_Unified/backend/functions/admin-leads/index.ts): `dw_alignment` select 안 함

### 6.2 변경

#### 6.2.1 voice-aggregates 확장

위치: [V_Voice/backend/functions/voice-aggregates/index.ts](../../../V_Voice/backend/functions/voice-aggregates/index.ts)

- SELECT에 `preference_axes` 포함
- 평균 계산:
  - Postgres 집계: `AVG((preference_axes->>'price')::int)::float / 5.0` (각 축별 1~5 → 0~1)
  - 또는 메모리에서 JSONB 평균 (응답 수 < 1만 시 OK)
- 반환 스키마:
  ```typescript
  {
    dw_avg: { price: number, fuel: number, durability: number, service: number, reference: number, versatility: number },  // 0~1
    by_segment_dw: {
      [segment: string]: { price: ..., fuel: ..., ... }
    }
  }
  ```

#### 6.2.2 Admin UI 라더 컴포넌트

위치: [S_Sensor/admin/app/voice/aggregates/page.tsx](../../../S_Sensor/admin/app/voice/aggregates/page.tsx)

새 컴포넌트:
```tsx
<DwRadarOverlay
  segments={data.by_segment_dw}
  hdStrength={hdStrengthMatrix}  // R_10.01.yaml § hd_strength_matrix 클라이언트 캐시
  comparison={['mining', 'construction_heavy']}  // 드롭다운 2 segment overlay
/>
```

SVG 라더 — dealer v2 [renderRadar()](../../../V_Voice/dealer/v2/index.html#L475-L530) 직접 포팅 (React 컴포넌트로 변환). 외부 라이브러리 의존 없음.

기능:
- segment 드롭다운: 2 segment overlay 비교 (Mining vs Construction 등)
- HD 강점 매트릭스(V_50.10)를 **점선 overlay**로 동시 표시
- "Fit gap" — 응답 평균과 HD 강점의 |diff| 절대값을 별도 축별 컬러 칩

#### 6.2.3 admin-leads 확장 (선택)

- SELECT에 `dw_alignment` 추가
- LeadsTable 컬럼: 0(회색) ~ 6(진녹) 색상 게이지

### 6.3 의존성
- 항목 2 (응답에 `preference_axes`·`dw_alignment` 채워져야 의미 있음)

### 6.4 통과 기준
- `/voice-aggregates?event=ctt_moscow_2026` 응답에 `dw_avg`·`by_segment_dw` 포함
- Admin `/voice/aggregates` 페이지에 평균 DW 라더 표시
- HD 강점 overlay로 segment별 fit gap 가시화
- (선택) `/leads` 페이지에 `dw_alignment` 컬럼 노출

### 6.5 위험
- JSONB 평균 계산 비용 — 응답 수 > 1만 시 메모리 압박. Postgres 집계함수 우선
- React 라더 SVG — Next.js 13 server component 호환 확인 (`'use client'` 필요)

---

## 7. 작업 순서 (DAG)

```
[P0 · 2026-05-23~25 · 출장 전]
  항목 1: scripts/verify-functions.sh + CI 통합

[P1 · 2026-05-30~06-02 · 출장 후]
  항목 2.2.1 computeDw lib (C_Common/packages/core/src/decision_weight.ts)
    ↓
  항목 2.2.2 responses-receive 분기 + save_response RPC 확장 (마이그레이션 034)
    ↓
  항목 2.2.4 LeadScoring R_10.01.005 활성 (shared/lead_scoring.ts)
    ↓
  항목 4.2.1 voice-aggregates 평균 DW
    ↓
  항목 4.2.2 Admin radar overlay

[P2 · 2026-06-03~ · 시연 검증 후]
  항목 2.2.3 dealer/v2 간접질문 UI 토글
  항목 3 Visitor PWA DW 6축 (응답률 측정 우선)
  항목 4.2.3 admin-leads dw_alignment 컬럼 (선택)
```

임계 경로: **항목 2 (P1)** — 산출 함수 없이는 R_10.01.005도 항목 4도 의미 없음.

---

## 8. 외부 의존 자산 (HD 인사이트)

- **HD 강점 매트릭스 시드** ([R_10.01_LeadScoring.yaml § hd_strength_matrix](../../../C_Common/r_10_rules/R_10.01_LeadScoring.yaml)) — 위버 1차 가정 → CTT Moscow 2026 출장(5/26~29) 미팅에서 정정 (외부 컨트롤 사이클 1회차)
- 정정 후 [R_20.01 RuleEditor](../../../R_Runtime/r20/) 또는 직접 `publish_rule()` RPC로 새 active row 발행

본 PRD의 모든 항목은 매트릭스 시드 정정에 영향 받지 않음 — 매트릭스 값은 런타임 로드.

---

## 9. 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-22 | v1 — DW 6축 도입 후 4 미완 영역 PRD 신설. P0~P2 우선순위·DAG 명시. |

## 참조
- 상위: `../decision_weight/README.md` (DW 인프라 PRD)
- 마이그레이션: `../../../C_Common/supabase/migrations/031_dw_indirect_inference.sql`·`032_dealer_v2_dw_axes_swap.sql`
- 룰: `../../../C_Common/r_10_rules/R_10.10_DecisionWeight.yaml`·`R_10.01_LeadScoring.yaml`
- 코드: `../../../V_Voice/dealer/v2/index.html` (renderRadar 재사용 자산)
- 운영: PR #5~#8 (https://github.com/weavermensch92/cesaas/pulls)
