# V_10 Dealer — v3 단일 HTML

> 부스 인터뷰. 6 axis + 7 marketing + NPS + consent → 8 segment 매칭 → Playbook 즉시. CTT Moscow 출장에서 직접 사용.

## 진입 (QR)

위버 R_20 도구가 Bearer JWT를 발급 → QR로 인코딩 → 딜러 태블릿에서 스캔.

```
https://dealer.{voice_domain}/?token={jwt}
```

페이지 로드 후 JWT가 `localStorage`에 저장되고, URL의 `?token` 은 즉시 제거됨 (시연 화면에 노출 X).

## 빌드·배포

이 디렉토리는 **단일 HTML 파일**. 빌드 단계 없음 — 그대로 정적 호스팅.

```powershell
# Supabase Storage 또는 정적 호스팅에 그대로 업로드:
supabase storage cp dealer/index.html ss://hosting/dealer/index.html
# 또는 Fly.io static · GitHub Pages 등.
```

> API 베이스는 페이지 로드 전 `window.HD_API_BASE = '...'` 로 주입.  배포 호스트가 inline `<script>` 삽입 또는 nginx replace 권장.

## 오프라인 작동

- 모든 자산 inline — CDN 의존 X
- IndexedDB 큐: 응답 → 즉시 큐에 저장 → 송출 워커가 30s 마다 drain
- online 이벤트 시 자동 drain
- 결과 Playbook은 클라이언트 R_10.05 + R_10.07 inline 데이터로 즉시 표시

## 책임 경계

| 클라이언트 (이 HTML) | 백엔드 |
|---|---|
| 6 axis 입력 + 7 marketing | `responses-receive` Edge Function |
| 클라이언트 R_10.05 segment 매칭 | 서버 R_10.05 재계산 — 불일치 시 서버 우선 |
| 클라이언트 R_10.07 Playbook 표시 | `save_response` RPC |
| Bearer JWT 헤더 + Idempotency-Key | Idempotency 24h |
| IndexedDB 오프라인 큐 | LeadScoring (U_Unified) 트리거 |

## inline 데이터 = R_10 스냅샷

`SURVEY` (설문)·`SEGMENT_RULES` (R_10.05)·`PLAYBOOKS` (R_10.07)는 빌드 시점 스냅샷.
운영 변경은:
1. DB rule_versions에 `publish_rule()` (005_runtime.sql)
2. 003_voice.sql `survey_questions` 업데이트
3. 새 HTML 빌드·재배포

> v2엔 `GET /v1/surveys/{id}` 와 `GET /v1/rules/{id}` 동기 fetch + 5min 캐시.
