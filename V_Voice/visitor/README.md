# V_20 Visitor — PWA (단일 HTML)

> 부스 방문객 18문항. QR 진입 → 익명 응답 → 결과 카드. 모바일 우선 (320~430px). 오프라인 가능.

## 진입 (QR)

부스 포스터의 QR → `https://visitor.{domain}/`. Bearer 토큰 없음. 첫 진입 시 `device_id`(UUID) 자동 생성 → `localStorage`.

## 빌드·배포

단일 HTML PWA. 빌드 단계 없음 — 그대로 정적 호스팅.

```powershell
# Supabase Storage 또는 임의의 정적 호스트
supabase storage cp ./visitor/index.html ss://hosting/visitor/index.html
supabase storage cp ./visitor/sw.js      ss://hosting/visitor/sw.js
supabase storage cp ./visitor/manifest.webmanifest ss://hosting/visitor/manifest.webmanifest
supabase storage cp ./visitor/icons      ss://hosting/visitor/icons --recursive

# API 베이스는 페이지 로드 전 inline script로 주입:
#   <script>window.HD_API_BASE = 'https://{ref}.supabase.co/functions/v1';</script>
```

> PWA로 동작하려면 **HTTPS** 필수. file:// 로 열면 PWA 설치·service worker는 비활성, UI/플로우만 동작.

## 화면 흐름

```
[QR 진입]
  → step 1/4 — 핵심 axis (회사 규모·용도·보유 장비·역할)
  → step 2/4 — 마케팅 5 (만족도·계획·요인·채널·경쟁사)
  → step 3/4 — NPS + 향후수신 + 데이터 수집 동의
  → [옵트인 프롬프트] "연락처 남기시겠어요?"
       ├─ 예 → step 4/4 — 상세 axis 2 + 연락처 3 + 자유 텍스트 (모두 선택)
       └─ 아니오 → 즉시 finalize (익명)
  → [결과 카드] segment 힌트 + HD 카탈로그 안내 + 설치 힌트
```

## 책임 경계

| 클라이언트 (PWA) | 백엔드 |
|---|---|
| device_id 자동 생성 (localStorage) | `X-Device-ID` 헤더 검증 |
| honeypot 필드 (hidden) | (앱이 검출하면 silently 무시) |
| 18문항 (필수 12 + 선택 6) | 24h device_id quota 5건 (`visitor_quota_remaining` RPC) |
| 클라이언트 R_10.05 segment 매칭 | 서버 R_10.05 재계산 — 불일치 시 서버 우선 |
| 결과 카드 즉시 표시 | 옵트인=true 만 contact_* 컬럼 보존 (`save_response` RPC) |
| IndexedDB 큐 + Service Worker | Idempotency-Key 24h |

## 데이터 모델

- `responses` (003_voice.sql) + 옵트인 컬럼 (009_voice_visitor.sql): `contact_opted_in`·`contact_name`·`contact_phone`·`contact_email`·`notes`·`pii_redacted_at`
- 시드: `surveys.id = 'survey_v1_visitor'` + 18 questions (필수 12 / 선택 6, 다국어 옵션)

## 오프라인 작동

- Service Worker (`sw.js`) — 셸 캐싱(cache-first) + navigate fallback to `index.html`
- IndexedDB 큐 (DB명 `hd_voice_visitor`, store `responses_queue`) — 응답을 큐에 저장 → 30초마다 drain → `online` 이벤트 시 즉시 drain
- 오프라인에서도 segment 매칭 + 결과 카드 즉시 표시

## Bot 방지

| 계층 | 방어 |
|---|---|
| 클라이언트 | hidden honeypot input — 채워지면 silently 가짜 성공 화면 (응답은 송출 X) |
| 백엔드 | `visitor_quota_remaining(device_id, 5)` → 24h 5건 초과 시 `rate_limited` |
| 백엔드 | `Idempotency-Key` 24h (중복 송출 첫 응답 반환) |

> hCaptcha 등은 v2 (러시아 ISP 도달성 검토 필요).

## 다국어

`ru` 디폴트 · `en` · `ko` 토글. 모든 user-facing 문자열은 `I18N` 객체 (`tx()`/`t()`). 설문 question label도 `{ru,en,ko}` 포함.

## 시연 점검 체크리스트 (CTT Moscow 가정)

- [ ] 320px·430px·iPad 폭에서 큰 버튼 터치 OK
- [ ] 비행기 모드 → 응답 → 결과 카드 즉시 표시 (offline pill 표기)
- [ ] 온라인 복귀 → 큐 자동 drain → DB INSERT 확인
- [ ] 옵트인 없이 finalize → contact_* NULL 저장 확인
- [ ] 옵트인 + 동일 device_id 6번째 시도 → 429 rate_limited
- [ ] Add to Home Screen → standalone display + Heritage Green 마크 아이콘 표시
- [ ] honeypot 채워보기 → 가짜 성공 + DB INSERT 없음

상세 — `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/V_Voice/V_20_Visitor/`.
