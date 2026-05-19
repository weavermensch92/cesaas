# R_Runtime — CLAUDE.md (구현)

> **모듈**: 하네스 2 (Runtime) — R_10 룰 + R_20 위버 도구 + harness2 lib.
> **상위**: `../CLAUDE.md`
> **하네스 룰 원본**: `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/R_Runtime/CLAUDE.md`
> **v0.2 상태**: R_10 시드 YAML + lib/ TS (types·load·evaluator·apply) + R_20 dealer 토큰 CLI. PRD-03 § 4 R-020~R-022 충족 (Phase B.1).

## 0. 정체성

| 영역 | 위치 |
|---|---|
| R_10 룰 YAML 시드 | `../C_Common/r_10_rules/*.yaml` |
| R_10 DB 관리 (rule_versions·publish_rule RPC) | `../C_Common/supabase/migrations/005_runtime.sql` |
| harness2 lib (Edge Function이 R_10 YAML 로드·적용) | `lib/` — `types.ts`·`load_rules.ts`·`evaluator.ts`·`apply_rules.ts`·`mod.ts` |
| R_20 위버 도구 | `r20/` (`@hd/r20`) |

## 0.5. lib 키워드 → 위치

| 키워드 | 파일 |
|---|---|
| 공통 타입 (RuleMeta·LeadScoringYaml·Grade·Segment 등) | `lib/types.ts` |
| YAML 로드 + 60s TTL 캐시 + DB version hot reload | `lib/load_rules.ts` |
| 조건 표현식 안전 평가 (`>= AND OR in NOT 괄호`) + action(`score += N`) | `lib/evaluator.ts` |
| applyLeadScoring·applyLeadQuality·classify*·applyFullPipeline | `lib/apply_rules.ts` |
| 단일 import barrel | `lib/mod.ts` |
| evaluator 단위 테스트 | `lib/tests/evaluator_test.ts` (실행: `cd R_Runtime && deno task test`) |

## 1. 책임 경계

| R_10 (룰) | R_20 (도구) |
|---|---|
| 런타임 LLM·classification·playbook 정의 | 운영 작업: 토큰 발급·룰 정정·일괄 재처리 |
| Edge Function이 DB에서 fetch (5분 캐시) | 위버 본인 머신 또는 protected 서버에서만 실행 |
| `publish_rule()` RPC로 변경 — 항상 새 row + archive | RLS service_role · IP allowlist · basic auth |

## 2. 흐름 (정확도 사이클)

```
[Admin 편집] normalized_field_edits 누적
     ↓
[위버] SELECT 분석 → 차이 패턴 발견
     ↓
[위버] R_20 → publish-rule (예정) → publish_rule('R_10.06', new_version, ...)
     ↓
[Edge Function] 5분 안에 rule_versions cache 무효 → 새 prompt 적용
     ↓
[Admin] 재정규화 트리거 또는 R_20 → retrigger-batch (예정)
     ↓
[normalize-worker] 새 prompt_version으로 일괄 재계산
     ↓
[Admin] 정확도 변화 측정
```

## 3. 후속

| 우선 | 영역 |
|---|---|
| H | Phase B.2 — R_10.01·.05·.06·.07·.08·.09 YAML을 harness1 스키마(rule_id·condition·action)로 재작성. 현재는 .02만 신규 추가, 나머지는 단순 스키마라 lib의 `applyLeadScoring` 등이 아직 동작 불가 |
| H | Phase B.3 — `core/rules.ts`·`core/llm.ts`·`shared/segments.ts`·normalize-worker·studio-build-survey 가 lib 사용으로 마이그레이션 |
| H | Phase C/D — `r20/bin/publish-rule.ts` (YAML → `publish_rule()` RPC) + `score_lead()` plpgsql을 lib 기반 Edge Function 호출로 교체 (NF-P01 60s hot reload) |
| M | `r20/bin/retrigger-batch.ts` — cluster_ids[] → `enqueue_normalize_priority` 일괄 |
| M | R_20 HTTP 게이트웨이 (Fly.io basic auth) — 위버 외부 접근 |
| L | `r20/bin/issue-csv-out.ts` — 발급 결과를 print용 PDF로 출력 |
