# Gridge Sensor (Chrome Extension MV3)

> S_Sensor 채널 — Russia 측 캡쳐·송출만. 분류·정규화는 한국 백엔드.

## 빌드·로컬 로드

```powershell
# 1) 시크릿 주입 — config.example.js → config.js 복사 후 값 채움
Copy-Item config.example.js config.js
# (편집 후) config.js 에 SUPABASE_REF·HMAC_SECRET·DEALER_ID 입력

# 2) Chrome → chrome://extensions → 개발자 모드 → 압축 해제된 확장 프로그램 로드
#    이 폴더(extension/) 선택
```

`config.js` 는 `.gitignore`. Production 빌드에서는 CI가 GCP Secret Manager로부터 주입.

## 책임 경계 (S_Sensor § 4)

- ✓ URL 매칭 (crm_definitions.json — data-driven)
- ✓ WebP 캡쳐 (quality 0.85 → 500KB 초과 시 0.7·0.5 fallback)
- ✓ 메타 부착 (url·viewport·dpr·spa_enter_time)
- ✓ 16KB 청크 분할 + HMAC + 8회 재시도
- ✓ IndexedDB 큐 1000건 + 오프라인 drain
- ✗ 화면 종류 분류 (Bitrix24 패턴 분기) — 백엔드 R_10.05
- ✗ entity_id 추출 — 백엔드 S_20.02

## 파일

| 파일 | 책임 |
|---|---|
| `manifest.json` | MV3 + 최소 permissions |
| `crm_definitions.json` | CRM 매트릭스 (S_40.02 — data-driven) |
| `content.js` | URL 매칭·SPA 라우팅 hook·debounced trigger |
| `background.js` | service worker — captureVisibleTab·queue·drain |
| `popup.html` / `popup.js` | 큐 상태·재시도·로그 |
| `lib/capture.js` | 메타 조립·quality fallback |
| `lib/chunk.js` | 16KB chunking |
| `lib/hmac.js` | HMAC-SHA256 + headers |
| `lib/sender.js` | 청크 송출·8회 백오프·finalize |
| `lib/queue.js` | IndexedDB CRUD·drain·trim |
| `lib/error.js` | 로그 저장·HTTP 분류 |

## API 컨트랙트

이 Extension은 한국 백엔드의 두 엔드포인트와 대화 (`C_03_API_패턴`):

- `POST /v1/captures/chunks` — 청크 1건 송신. body JSON.
- `POST /v1/captures/finalize` — 합성·hash 검증.

HMAC 헤더: `Authorization: HMAC {key_id}:{sig}` · `X-Timestamp` · `X-Nonce`. 청크별 `Idempotency-Key: {capture_id}-chunk-{i}`.

상세 — `../../C_Common/CLAUDE.md` § 4.4 + `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/S_Sensor/S_10_Extension/`.
