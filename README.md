# HD건설기계 PoC

> 러시아 딜러 ↔ HD 본사 영업 깔때기를 AI가 운영 — Sensor + Voice 두 채널을 통합 서비스로 묶는 11일 검증 PoC.

![status](https://img.shields.io/badge/status-v0.5-008233) ![hosting](https://img.shields.io/badge/host-Supabase%20Tokyo-002554) ![admin](https://img.shields.io/badge/admin-Fly.io%20nrt-00AD1D)

## 무엇

- **S_Sensor** — Chrome Extension(MV3)이 Bitrix24 CRM 화면을 자동 캡쳐 → 한국 서버 HMAC 송출 → Claude Vision으로 13개 영업 필드 정규화.
- **V_Voice** — Dealer 단일 HTML 31문항 + Visitor PWA 18문항 → 8 segment 자동 매칭 → R_10.07 Playbook 즉시 발급.
- **U_Unified** — 두 채널을 같은 entity_id로 응집 → R_10.01 LeadScoring → DealerOutput 자동 생성.
- **R_Runtime** — 외부 룰 (R_10 YAML) · 위버 도구 (R_20 JWT/QR 발급 CLI).
- **T_Test** — T_04+T_05+T_06 자동 E2E runner + T_08 통과 판정 페이지 (9 정량 지표).

## 빠르게 보기 (백엔드 없이)

```powershell
Start-Process "_preview\index.html"
```

→ Dealer · Visitor PWA · Admin · Studio · Leads · T_08 verdict 모두 mock 데이터로 둘러볼 수 있습니다. [`_preview/README.md`](./_preview/README.md).

## 실서버 배포

[`DEPLOY.md`](./DEPLOY.md) — GitHub + Supabase Tokyo + Fly.io 순차 runbook.

| Phase | 무엇 |
|---|---|
| 0 | 시크릿 grep · `.gitignore` 보호 확인 (Public repo) |
| 1 | GitHub Public + Actions Secrets |
| 2 | Supabase 프로젝트 + 마이그레이션 11개 + Edge Function 16개 + pg_cron |
| 3 | Fly.io Admin (Tokyo) Next.js standalone |
| 4 | Dealer HTML / Visitor PWA 정적 서빙 |
| 5 | R_20 토큰·QR 일괄 발급 (출장 전) |
| 6 | T_Test runner smoke test |
| 7 | D-day 시연 체크리스트 |

## 작업 룰 (MUST)

1. 모든 코드·문서·UI에서 `hyundai` / `현대` 표기 **금지**. `HD` 또는 `HD건설기계`만 사용.
2. 새 파일 만들기 전 해당 폴더 `CLAUDE.md` 먼저 읽기.
3. LLM 호출은 R_10.06 YAML 로드. 프롬프트 하드코드 금지.
4. API는 `/v1` prefix · 공통 에러 포맷 · cursor pagination · `Idempotency-Key` 헤더.
5. **시크릿은 Supabase secrets / Fly.io secrets / GitHub Actions secrets에만**. commit X. → [`SECURITY.md`](./SECURITY.md).

상세 — [`CLAUDE.md`](./CLAUDE.md).

## 로컬 개발

```bash
npm install
supabase start                              # Docker 필요
supabase migration up
npm run dev -w @hd/sensor-admin             # http://localhost:3001
```

각 surface — `S_Sensor/{extension,backend,admin}` · `V_Voice/{dealer,visitor,backend}` · `T_Test/runner` · `R_Runtime/r20`.

## 디렉토리

```
hd-hyundai-poc/
├── CLAUDE.md  · DEPLOY.md  · SECURITY.md  · LICENSE  · README.md
├── _preview/                          백엔드 없이 화면 갤러리
├── PRD/                               요구사항·통과 기준
├── C_Common/                          공통 인프라 (Supabase·core·design·R_10 seed)
├── S_Sensor/                          Extension MV3·백엔드·Admin Next.js
├── V_Voice/                           Dealer HTML·Visitor PWA·응답 백엔드
├── U_Unified/                         Lead 응집·LeadScoring·DealerOutput
├── R_Runtime/                         하네스 2 — R_10 YAML·R_20 도구
├── T_Test/                            E2E runner·T_08 verdict 페이지
└── .github/workflows/                 audit-secrets + deploy CI/CD
```

## 라이선스

[MIT](./LICENSE) — 코드 자체. **HD건설기계 영업 데이터·CRM 캡쳐는 별도 비공개 자산**.

---

## 가치

- **하네스 방법론** — PRD·코드·룰·테스트가 같은 폴더 트리에서 일관된 인덱스로. 11일 PoC가 다른 케이스(다른 산업·CRM)에 그대로 적용 가능.
- **외부 컨트롤 사이클** — HD 검토자 편집 → 위버 `publish_rule()` 정정 → 정확도 변화 자동 측정. T_07.02·T_08 자동.
- **CRM-agnostic** — Bitrix24는 첫 사례. `crm_definitions` JSONB INSERT만으로 새 CRM 확장.

문의 — weaver@gridge.co.kr
