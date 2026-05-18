# S_Sensor — Admin UI (Next.js)

> HD admin이 캡쳐·정규화 결과 검토·편집·재정규화. S_50 화면.

## 로컬 실행

```powershell
# 루트(hd-hyundai-poc)에서
npm install

# admin 폴더
Copy-Item .env.example .env.local
# .env.local 의 SUPABASE URL/anon key 채움
npm run dev -w @hd/sensor-admin
# → http://localhost:3001
```

> 폰트 (HD Sans = HD체) 는 `public/fonts/HDSans-{Light,Medium,Bold}.ttf` 로 배치. 없으면 Noto Sans KR로 자동 fallback.

## 페이지

| 경로 | 본질 | 백엔드 |
|---|---|---|
| `/` | 캡쳐 목록 (필터·cursor pagination) | `admin-captures` |
| `/clusters/[id]?crm=...` | 클러스터 상세 — 13 필드 + 5장 이미지 + 편집 + 재정규화 + audit | `admin-clusters` + `admin-field-edit` + `admin-normalize-trigger` |

URL의 `[id]`는 UUID (cluster id) 또는 entity_id 둘 다 OK. entity_id 사용 시 `?crm=bitrix24` 필수.

## 인증

Supabase Auth · Magic Link. 도메인 화이트리스트는 백엔드 `ADMIN_EMAIL_DOMAINS` secret 으로 강제. 로그인 후 자동 진입.

## 디자인 시스템

- `@hd/design/styles` (CI 토큰 + 컴포넌트 클래스)
- `@hd/design/i18n` ko/ru — 모든 user-facing 문자열은 `tx()` / `makeT()` 통과.
- 추가 클래스가 필요하면 `@hd/design` 에 먼저 정의 (UI 안에 하드코드 X).

## 데이터 흐름 (정확도 사이클)

```
Extension --> captures-chunks/finalize --> normalize-worker
                                              ↓
                                         normalized_fields(active)
                                              ↓
   Admin /clusters/[id] --> 편집 --> normalized_field_edits + normalize_audit
                                              ↓
                          (위버) publish_rule('R_10.06', new_version, ...) — DB에서
                                              ↓
                          Admin '재정규화' 클릭 --> admin-normalize-trigger
                                              ↓
                          normalize-worker (high priority) → 새 normalized_fields(active)
                                              ↓
                          이전 → superseded
```

## 책임 경계

| Admin UI (이 폴더) | 백엔드 |
|---|---|
| 캡쳐 목록·필터·페이지네이션 표시 | `admin-captures` Edge Function |
| 13 필드 편집 form | `admin-field-edit` Edge Function — `edit_normalized_field` RPC |
| 재정규화 버튼 | `admin-normalize-trigger` Edge Function — `enqueue_normalize_priority` RPC |
| 이미지 viewer (`<img src signedUrl>`) | `admin-clusters` Edge Function |
| **DB 직접 접근 X** — 모든 쓰기는 RPC 경유 | RLS · audit · 화이트리스트 강제 |

상세 — `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/S_Sensor/S_50_AdminView/`.
