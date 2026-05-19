# DEPLOY-FALLBACK — Fly.io Edge fallback 배포 (T_07.01)

> **목적**: 러시아 부스 → Supabase Tokyo Edge 도달 실패 시 Voice 응답 수신 경로를 Fly.io Tokyo로 우회.
> **상태**: Phase 1 — `/responses-receive` 만 mirror. Sensor 캡쳐 경로(captures-chunks·finalize)는 Phase 2.
> **관련 가설**: H_도달성 — Supabase·Fly.io 양쪽 도달성으로 부스 마비 최소화.

---

## 0. 아키텍처

```
[부스 단말 (러시아)]
       │
       ├── 1순위: https://<supabase-ref>.supabase.co/functions/v1/responses-receive  (primary)
       │
       └── 2순위: https://hd-poc-edge.fly.dev/responses-receive                       (fallback, Tokyo)
                       │
                       └── 동일 Supabase DB (Tokyo) 직접 INSERT
```

- **데이터 정합성**: idempotency-key 헤더로 양쪽 호출 중복 차단.
- **인증**: 동일 VOICE_JWT_SECRET 사용 (양쪽 토큰 호환).
- **DB 책임**: 트리거·RPC 모두 Supabase DB에 있으므로 양쪽 Edge에서 동일 결과.

---

## 1. 사전 점검

```powershell
cd "f:\2_work\2_소프트스퀘어드내부\6_aiops\16_hd\hd-hyundai-poc-prd-v1\hd-hyundai-poc"

# 1) 시크릿이 fly_edge/ 아래에 commit 안 됐는지 — DEPLOY.md § 0.1 패턴
git ls-files fly_edge/ | xargs grep -nE 'sk-ant-|SUPABASE_SERVICE|VOICE_JWT_SECRET\s*=\s*[^_]' 2>$null
# → 결과 비어있어야 함

# 2) Docker context 사이즈 확인 (큰 파일 누락 검출)
docker build -t hd-poc-edge -f fly_edge/Dockerfile . --no-cache --target builder 2>&1 | Select-String -Pattern 'Sending|Building'

# 3) Deno 로컬 실행 smoke test (포트 8080)
$env:SUPABASE_URL='https://<your-ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='<your-service-role>'
$env:VOICE_JWT_SECRET='<your-jwt-secret>'
$env:VOICE_JWT_ISSUER='hd-poc'
deno run --config fly_edge/deno.json --allow-net --allow-env --allow-read fly_edge/main.ts

# 다른 터미널에서
curl http://localhost:8080/health
# → {"ok":true,"service":"hd-poc-edge",...}
```

---

## 2. Fly.io 앱 생성 (1회)

```bash
flyctl auth login
flyctl apps create hd-poc-edge --org gridge

# 또는 fly.toml의 app 이름 확인 후
flyctl status --app hd-poc-edge   # 없으면 create
```

---

## 3. 시크릿 설정

```bash
flyctl secrets set --app hd-poc-edge \
  SUPABASE_URL="https://<your-ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service_role_jwt>" \
  VOICE_JWT_SECRET="<hex_32_or_more>" \
  VOICE_JWT_ISSUER="hd-poc"
```

`SUPABASE_SERVICE_ROLE_KEY` 는 **Supabase Dashboard → Project Settings → API → service_role** 의 secret JWT. PoC 운영 끝나면 회전 권장.

---

## 4. 배포

```bash
cd "f:\2_work\2_소프트스퀘어드내부\6_aiops\16_hd\hd-hyundai-poc-prd-v1\hd-hyundai-poc"

flyctl deploy --config fly_edge/fly.toml --remote-only

# 배포 후 즉시 확인
curl https://hd-poc-edge.fly.dev/health
# → {"ok":true,"service":"hd-poc-edge","role":"fly_io_fallback","region":"nrt", ...}
```

`--remote-only` — 로컬에서 Docker 빌드하지 않고 Fly의 빌더 사용 (Windows 빌드 환경 차이 회피).

---

## 5. 부스 운영 모드 (min_machines_running)

평시 `min_machines_running = 0` (콜드 스타트 — 첫 요청 후 ~3초 지연 발생) → 비용 최소화.

**부스 운영 기간(예: CTT Moscow 2026 5/26~29)에는 1대 항상 유지** 권장:

```bash
flyctl scale count 1 --app hd-poc-edge --region nrt
# 출장 종료 후 다시 0으로
flyctl scale count 0 --app hd-poc-edge --region nrt
```

또는 fly.toml의 `min_machines_running = 0` 을 `1`로 변경 후 재배포.

---

## 6. 부스 단말 측 fallback 활성화 (별도 PR)

현재 단말(`V_Voice/dealer/index.html`)은 **단일 API_BASE** 사용. T_07.01 fallback을 실제로 사용하려면 단말 측에 fallback 로직 필요:

```javascript
// Phase 2 — 별도 작업
const PRIMARY = 'https://<supabase-ref>.supabase.co/functions/v1';
const FALLBACK = 'https://hd-poc-edge.fly.dev';

async function postWithFallback(path, body, opts) {
  try {
    const res = await fetch(`${PRIMARY}${path}`, { ...opts, body });
    if (res.ok || res.status >= 400 && res.status < 500) return res;  // 4xx는 비즈니스 오류 — fallback 안 함
    throw new Error(`primary ${res.status}`);
  } catch {
    return fetch(`${FALLBACK}${path}`, { ...opts, body });
  }
}
```

지금은 인프라만 준비 — 단말 측 wiring은 다음 단계.

---

## 7. T_07.01 측정

```powershell
# T_TEST_FALLBACK_BASE 환경변수 설정 후 t07 실행
$env:T_TEST_FALLBACK_BASE = 'https://hd-poc-edge.fly.dev'
cd T_Test/runner
npm run t07 -w @hd/t-test
# → T_07.01 dual-send 시나리오 추가 실행 (primary vs fallback 양쪽 응답 비교)
```

`T_TEST_FALLBACK_BASE` 미설정 시 T_07.01은 자동 skip (T_07.02 mechanics만 실행).

---

## 8. 롤백 / 비상 차단

```bash
# 즉시 stop
flyctl scale count 0 --app hd-poc-edge

# 또는 앱 자체 일시 비활성화
flyctl apps destroy hd-poc-edge   # 영구 삭제 (재배포 시 재생성)
```

DB는 영향 없음 (Supabase 측 그대로). fallback이 dead가 돼도 primary는 정상.

---

## 9. 후속 작업

| 우선 | 항목 |
|---|---|
| H | Phase 2 — captures-chunks·captures-finalize (Sensor 캡쳐 경로) handler 분리 + main.ts router 추가 |
| H | 부스 단말 측 fallback wiring (위 § 6) |
| M | dealer-consultations·dealer-tokens-* 도 mirror (Phase 3) |
| M | health check에 DB ping 추가 (현재는 정적 응답만 — 실 readiness 검증 X) |
| L | Fly.io 로그를 Supabase 측 통합 로깅 시스템으로 전송 |

---

## 10. 비용 추정

- 평시 (min=0): $0/월 (요청 시에만 wake-up)
- 부스 기간 (min=1, shared-cpu-1x, 256MB): ~$2~3/월
- 트래픽: 부스 4일간 ~5000 응답 → 무시 가능

PoC 끝나면 `flyctl apps destroy hd-poc-edge` 로 정리.
