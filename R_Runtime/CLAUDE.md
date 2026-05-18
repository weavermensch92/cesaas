# R_Runtime — CLAUDE.md (구현)

> **모듈**: 하네스 2 (Runtime) — R_10 룰 + R_20 위버 도구.
> **상위**: `../CLAUDE.md`
> **하네스 룰 원본**: `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/R_Runtime/CLAUDE.md`
> **v0.1 상태**: R_10 시드 YAML (C_Common 측) + R_10 DB 관리 (rule_versions) + R_20 dealer 토큰 CLI.

## 0. 정체성

| 영역 | 위치 |
|---|---|
| R_10 룰 YAML 시드 | `../C_Common/r_10_rules/*.yaml` |
| R_10 DB 관리 (rule_versions·publish_rule RPC) | `../C_Common/supabase/migrations/005_runtime.sql` |
| R_20 위버 도구 | `r20/` (`@hd/r20`) |

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
| H | `r20/bin/publish-rule.ts` — YAML 파일 → `publish_rule()` RPC. R_10 정정 표준 흐름 |
| M | `r20/bin/retrigger-batch.ts` — cluster_ids[] → `enqueue_normalize_priority` 일괄 |
| M | R_20 HTTP 게이트웨이 (Fly.io basic auth) — 위버 외부 접근 |
| L | `r20/bin/issue-csv-out.ts` — 발급 결과를 print용 PDF로 출력 |
