# 보안 정책 / Security Policy

> 이 리포는 **PUBLIC**입니다. 모든 시크릿은 외부 secret store (Supabase secrets · Fly.io secrets · GCP Secret Manager) 에만 존재해야 합니다.

## 절대 commit 하지 않는 항목

- `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_ANON_KEY` (anon은 클라이언트에 노출되지만 .env로 관리)
- `ANTHROPIC_API_KEY`
- `VOICE_JWT_SECRET` · HMAC `SENSOR_HMAC_SECRET`
- 실 dealer 명단·연락처 (PII)
- 캡쳐 WebP 파일 (잠재적 PII 포함)
- `*.csv`, `*.xlsx` 데이터 dump

`.gitignore` 가 위 항목 전부 보호. 실수로 commit한 경우:

1. **즉시 키를 회수·교체** (commit revert ≠ git 히스토리 삭제. 푸시된 시크릿은 노출됐다고 가정)
2. `git rm --cached <file>` + `.gitignore` 보강
3. `git filter-repo` 또는 BFG로 히스토리에서 제거 (필요 시)

## 취약점 신고

- 공개 issue 대신 — privately to: weaver@gridge.co.kr
- 응답 SLA: 영업일 2일

## 자동 점검

- GitHub Actions `audit-secrets.yml` — 매 PR 시 시크릿 패턴 grep
- pre-commit hook 권장 (`npm install -D @secretlint/secretlint`)

## 데이터 보안

- HD 영업 데이터는 Supabase DB에만 존재. 절대 export 후 commit X.
- 30일 자동 익명화 cron (C_07_보안_법무.md, `pii_redacted_at`).
- TLS 1.3 · CORS 화이트리스트 · RLS service_role 분리.

## 키 회전 절차

| 키 | 회전 주기 | 절차 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 6개월 또는 사고 시 | Supabase Dashboard → JWT secret 재생성 |
| `ANTHROPIC_API_KEY` | 위버 정책 | Anthropic Console에서 새 키 → Supabase secrets 갱신 |
| `VOICE_JWT_SECRET` | 6개월 또는 사고 시 | 새 secret → Edge Function 재배포. 발급된 JWT는 만료까지 사용 |
| `SENSOR_HMAC_SECRET` (dealer 단위) | 1년 또는 dealer 교체 시 | `sensor_api_keys.revoked_at` set + 새 row INSERT |

상세 — `C_Common/C_04_인증.md` § 7 · `C_Common/C_07_보안_법무.md`.
