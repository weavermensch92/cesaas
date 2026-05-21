# DecisionWeight (DW) 6축 — PRD specs

> **버전**: v1 (2026-05-22)
> **상위**: `../../README.md` · `../../../CLAUDE.md`
> **하네스 원본**: `../../../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/V_Voice/V_50_Data/V_50.08_*`

이 폴더는 HD건설기계 PoC의 **결정 가중치 6축(DecisionWeight)** PRD 명세입니다. 응답자가 직접 답하지 않고 간접 질문에서 추론하는 6 축으로, 영업 무기 정렬·LeadScoring 가산·포지셔닝 시각화에 사용됩니다.

## 파일 목록

| 파일 | 내용 |
|---|---|
| `V_50.08_DecisionWeight_6axis.md` | DW 6축 정의·도메인·다국어 라벨·CA(기존 6 axis)와 차이 |
| `V_50.09_간접질문_매핑.md` | 간접 6질문 본문 + 보기별 DW 가중치 매트릭스 + LLM 보조 사양 |
| `V_50.10_HD강점_매트릭스.md` | 8 segment × 6 DW HD 강점 매트릭스 (위버 시드 — HD 검증 대기) |
| `R_10.10_DecisionWeight.md` | DW 산출 룰 (룰 모드 + LLM 보조) |

## 구현 위치 매핑

| 자산 | 위치 |
|---|---|
| DW 컬럼 (1~5 정수) | `responses.preference_axes` JSONB ([025_dealer_v2_preference_axes.sql](../../../C_Common/supabase/migrations/025_dealer_v2_preference_axes.sql)) |
| DW 원응답 (간접질문 5) | `responses.dw_raw_answers` JSONB ([031_dw_indirect_inference.sql](../../../C_Common/supabase/migrations/031_dw_indirect_inference.sql)) |
| DW 산출 메타 | `responses.dw_extraction` JSONB ([031](../../../C_Common/supabase/migrations/031_dw_indirect_inference.sql)) |
| LeadScoring 가산 캐시 | `leads.dw_alignment` REAL ([031](../../../C_Common/supabase/migrations/031_dw_indirect_inference.sql)) |
| R_10.10 추론 룰 | [C_Common/r_10_rules/R_10.10_DecisionWeight.yaml](../../../C_Common/r_10_rules/R_10.10_DecisionWeight.yaml) + DB rule_versions |
| R_10.01.005 dw_alignment_bonus | [C_Common/r_10_rules/R_10.01_LeadScoring.yaml](../../../C_Common/r_10_rules/R_10.01_LeadScoring.yaml) + DB rule_versions |

## 6축 ID (prd-v1 스키마와 일치)

`price · fuel · durability · service · reference · versatility`

> 하네스 v1 docs의 `uptime`은 prd-v1의 **`fuel`**과 동일 (Fuel Efficiency / Uptime 묶음). 본 폴더의 명세는 `fuel`로 통일.

## 점수 도메인

- **저장**: `responses.preference_axes` 1~5 정수
- **R_10.10 내부 산출**: 0~1 float
- **변환**: `preference_axes[axis] = clamp(1 + round(4 * dw_normalized[axis]), 1, 5)` (R_10.10.005)

## 추론 vs 직접 입력 — 공존

- **딜러 v2 (직접 입력)**: 딜러가 인터뷰 중 6 축 1~5 직접 토글 (`025_dealer_v2_preference_axes.sql`)
- **간접 추론 (R_10.10)**: Q3'~Q7' 5문항 + Q8' 자유응답 → 6축 추론 → 1~5 변환 후 저장

둘 다 `responses.preference_axes` 컬럼에 저장됩니다. 구분은 `dw_extraction.method`로 (없으면 직접 입력).

## 후속 정리 PRD

본 인프라 배포(2026-05-21) 후 남은 4 미완 영역 — `computeDw()` 산출 함수·간접질문 UI·Visitor PWA DW 적용·Admin 시각화 — 은 **[../follow_up_cleanup/README.md](../follow_up_cleanup/README.md)** 에 사양 정리.
