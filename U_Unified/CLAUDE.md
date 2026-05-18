# U_Unified — CLAUDE.md (구현)

> **모듈**: Sensor + Voice 응집 통합 서비스 시드.
> **상위**: `../CLAUDE.md`
> **하네스 룰 원본**: `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/U_Unified/CLAUDE.md`
> **v0.1 상태**: leads · lead_links · dealer_outputs + 트리거 + score_lead RPC + Admin (Edge Functions + Next.js routes).

---

## 0. 정체성

**같은 `(entity_id, crm_id)`의 Sensor capture + Voice response를 1개 Lead로 응집.** v1 시드. v2엔 시간순 + 다대다 Linkage.

핵심 가설: **H_채널통합** (cluster + response → same Lead).

---

## 1. 키워드 → 위치

| 키워드 | 위치 |
|---|---|
| leads · lead_links · dealer_outputs 스키마 + FK | `../C_Common/supabase/migrations/004_unified.sql` |
| score_lead RPC (R_10.01 미러) | 004_unified.sql `score_lead()` |
| generate_dealer_output RPC (R_10.07) | 004_unified.sql `generate_dealer_output()` |
| upsert_lead_from_cluster · upsert_lead_from_response | 004_unified.sql |
| 트리거 (cluster→lead, response→lead) | 004_unified.sql `trg_clusters_lead` · `trg_responses_lead` |
| Admin Edge Functions (목록·상세) | `backend/functions/admin-leads-{,detail}/index.ts` |
| Admin UI (Next.js 라우트) | `../S_Sensor/admin/app/leads/{page.tsx, [id]/page.tsx}` |

---

## 2. 응집 흐름

```
[Sensor]
captures-finalize → entity_clusters UPSERT (status='pending_normalize')
                   → trigger trg_clusters_enqueue → normalize_queue
                   ↓
normalize-worker → save_normalized_with_supersede → cluster.status='normalized'
                   ↓
trigger trg_clusters_lead → upsert_lead_from_cluster
                            ├─ leads UPSERT (entity_id, crm_id) UNIQUE
                            ├─ lead_links INSERT (cluster_id)
                            ├─ captures.lead_id 역방향 갱신
                            ├─ score_lead (R_10.01)
                            └─ generate_dealer_output (R_10.07)

[Voice]
responses-receive → save_response RPC → INSERT responses
                   ↓
trigger trg_responses_lead → upsert_lead_from_response
                            ├─ entity_id 있으면 → leads UPSERT (same entity)
                            ├─ 없으면 → 회사명 lookup or standalone
                            ├─ lead_links INSERT (response_id)
                            ├─ score_lead (Sensor + Voice 합산)
                            └─ generate_dealer_output
```

---

## 3. 데이터 모델 (004_unified.sql)

| 테이블 | 책임 |
|---|---|
| `leads` | UNIQUE(entity_id, crm_id) · score 0~100 · priority P1~P5 · 요약 컬럼 (회사·연락처·금액·단계·관심 장비) |
| `lead_links` | (source_table, source_id) UNIQUE — clusters/responses → lead 매핑 audit |
| `dealer_outputs` | R_10.07 Playbook 발급 이력 — segment + priority + score_snapshot |

**RLS**: service_role 전권 / `is_hd_admin()` read.

**역방향 FK 추가**: `captures.lead_id`, `entity_clusters.lead_id`, `responses.lead_id` → `leads(id) ON DELETE SET NULL` (004에서 ALTER).

---

## 4. R_10.01 LeadScoring 가중치 — 함수에 인라인 (PoC v1)

`score_lead()` plpgsql에 R_10.01_LeadScoring.yaml 가중치 미러. 변경 시:
1. `C_Common/r_10_rules/R_10.01_LeadScoring.yaml` 수정
2. `publish_rule('R_10.01_LeadScoring', new_version, yaml, ...)` (audit)
3. **`004_unified.sql` `score_lead()` 함수 갱신** (PoC v1 — v2엔 rule_versions JSONB 동적 로드로 교체)
4. `score_version` 컬럼 새 버전으로 갱신

---

## 5. 후속

| 우선 | 영역 |
|---|---|
| H | T_06 통합 E2E — 같은 entity_id로 Sensor capture + Voice response 흘려보내 `sensor_count·voice_count` 모두 ≥1, score 합산 확인 |
| H | Lead 검색 — Admin UI에 회사명·연락처 fuzzy 검색 (현재 ilike LIKE prefix) |
| M | `score_lead` v2 — rule_versions에서 가중치 JSON 동적 로드 (`body_json -> 'weights' -> ...`) |
| M | Linkage 다대다 (v2) — 같은 Voice 응답이 여러 Lead에 매핑되는 경우 |
| M | DealerOutput payload 풀 (R_10.07 텍스트까지 — 현재는 segment+priority 기록만) |
| L | Lead merge UI — Admin이 중복 Lead 수동 병합 (merged_into 컬럼 활용) |

---

## 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-18 | v0.1 — `004_unified.sql`(leads·lead_links·dealer_outputs + score_lead·generate_dealer_output·upsert_* RPC + 트리거 2개 + FK) + 2 Edge Functions(admin-leads, admin-leads-detail) + Next.js `/leads` + `/leads/[id]` + SectionNav |
