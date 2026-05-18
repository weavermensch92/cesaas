# _preview/ — 화면 갤러리

> 백엔드 없이도 지금까지 만든 UI·플로우를 한눈에. 디자인 검토·시연 사전 점검·문서 캡쳐용.

## 여는 방법

### Option A — 그냥 파일 열기

```powershell
# 가장 간단 — file:// 로 직접
Start-Process "_preview\index.html"
```

브라우저 보안 정책에 따라 일부 link가 차단될 수 있음. 그럴 땐 Option B.

### Option B — 정적 서버

```powershell
npx serve .
# → http://localhost:3000/_preview/
```

(`npx serve`가 없으면 `npx http-server`도 OK)

### Option C — 워크스페이스 실행

```powershell
# admin 실 화면 (Supabase 필요)
npm install
Copy-Item S_Sensor\admin\.env.example S_Sensor\admin\.env.local
# .env.local 채운 뒤
npm run dev -w @hd/sensor-admin
# → http://localhost:3001
```

## 화면 카탈로그

| 화면 | 종류 | 파일 |
|---|---|---|
| 갤러리 (이 페이지) | LIVE | [`index.html`](./index.html) |
| Dealer 단일 HTML — 6 axis · NPS · Playbook | LIVE | [`../V_Voice/dealer/index.html`](../V_Voice/dealer/index.html) |
| Extension Popup — 큐 상태·로그 | LIVE preview | [`extension-popup.html`](./extension-popup.html) |
| Admin 캡쳐 목록 (정적 mock) | MOCK | [`admin-mock.html#captures`](./admin-mock.html#captures) |
| Admin 클러스터 상세 (정적 mock) | MOCK | [`admin-mock.html#cluster`](./admin-mock.html#cluster) |
| Admin Next.js (실 백엔드) | DEPS | `S_Sensor/admin/` |
| R_20 토큰 발급 CLI | DEPS | `R_Runtime/r20/` |
| Edge Functions (7개) | DEPS | `S_Sensor/backend/` · `V_Voice/backend/` |

- **LIVE** — 파일을 그냥 열면 끝. 디자인·플로우 검증 가능.
- **MOCK** — 데이터는 inline. UI·정보 구조만 확인용. 실제 동작 X.
- **DEPS** — Supabase + Anthropic 키 필요. 실 데이터 흐름.

## 시연 시나리오 (CTT Moscow 가정)

1. `dealer/index.html` 풀스크린 — 출장에서 직접 사용 surface
2. `?lang=ru` 토글 → ru / en / ko 확인
3. 6 axis 입력 → segment 매칭 → Playbook 즉시 표시 확인
4. (백엔드 있으면) IndexedDB 큐 → drain → DB INSERT 확인
5. `_preview/admin-mock.html#cluster` — HD 본사 검토자 시점 데모
