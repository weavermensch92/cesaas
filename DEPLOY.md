# DEPLOY — Git 푸시 + 실서버 배포 런북

> **타겟**: GitHub Public + Supabase (Tokyo) + Fly.io (Tokyo).
> CTT Moscow 2026 출장(5/26~29) 시연·운영용.

---

## 0. 사전 점검 (배포 전 ⚠️)

이 리포는 **PUBLIC**. 시크릿이 한 번이라도 commit되면 푸시 후 영구 노출입니다.

### 0.1 시크릿 그렙 (빠뜨림 검출)

```powershell
# 리포 루트에서
cd "f:\2_work\2_소프트스퀘어드내부\6_aiops\16_hd\hd-hyundai-poc-prd-v1\hd-hyundai-poc"

# 1) sk-ant- (Anthropic), eyJ... (JWT), 32바이트 hex secret 패턴
git ls-files | xargs grep -nE 'sk-ant-[a-zA-Z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ' 2>$null
git ls-files | xargs grep -nE '[A-Fa-f0-9]{40,}'  2>$null | Select-String -NotMatch 'lock|sha|hash|integrity|node_modules'

# 2) .env / config.js 실 값 검사
Get-ChildItem -Recurse -Include '.env','.env.local','config.js' -ErrorAction SilentlyContinue
```

### 0.2 보호 목록 확인 (.gitignore가 잡는지)

```powershell
git check-ignore -v `
  S_Sensor/extension/config.js `
  R_Runtime/r20/.env.local `
  R_Runtime/r20/out/anything.png `
  T_Test/runner/.env.local `
  S_Sensor/admin/.env.local
```

모두 `.gitignore:line:rule` 로 출력되면 OK.

### 0.3 외부 시크릿 store 준비

| 항목 | 어디 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API |
| `ANTHROPIC_API_KEY` | Anthropic Console |
| `VOICE_JWT_SECRET` | 위버 로컬에서 `openssl rand -hex 32` 생성 |
| `SENSOR_HMAC_SECRET_<dealer>` | DB `sensor_api_keys` row INSERT (R_20 발급 시 자동) |
| GitHub Secrets | repo Settings → Secrets and variables → Actions |
| Supabase secrets | `supabase secrets set KEY=VAL --project-ref ...` |
| Fly.io secrets | `flyctl secrets set KEY=VAL --app ...` |

---

## 1. Phase 1 — GitHub Public repo

### 1.1 GitHub CLI 설치·로그인

```powershell
winget install --id GitHub.cli   # 또는 https://cli.github.com
gh auth login
```

### 1.2 Git 초기화·첫 commit

```powershell
cd "f:\2_work\2_소프트스퀘어드내부\6_aiops\16_hd\hd-hyundai-poc-prd-v1\hd-hyundai-poc"

git init -b main
git add .
git status                   # tracked 파일 검토 — .env*/config.js/QR PNG 없어야 함
git commit -m "chore: initial public release · HD건설기계 PoC v0.5"
```

### 1.3 원격 repo 생성·푸시

```powershell
gh repo create gridge/hd-poc --public --source=. --remote=origin `
  --description "HD건설기계 PoC · Russia↔Korea sales funnel AI · 11-day verification"
git push -u origin main

# main 보호 (force push 금지)
gh api -X PUT "repos/gridge/hd-poc/branches/main/protection" `
  -f required_status_checks='{"strict":true,"contexts":["typecheck","grep"]}' `
  -f enforce_admins=false `
  -f required_pull_request_reviews='{"required_approving_review_count":0}' `
  -f restrictions=null
```

### 1.4 GitHub Secrets 등록

```powershell
gh secret set SUPABASE_ACCESS_TOKEN          # supabase login 후 ~/.supabase/access-token
gh secret set SUPABASE_REF_PROD              # 예: abcdefghijklmno
gh secret set SUPABASE_REF_STAGING
gh secret set SUPABASE_DB_PASSWORD_PROD
gh secret set SUPABASE_DB_PASSWORD_STAGING
gh secret set FLY_API_TOKEN                  # flyctl auth token
```

이후 `git push` → `.github/workflows/deploy.yml` 자동 실행 + `audit-secrets.yml` 검사.

---

## 2. Phase 2 — Supabase (Tokyo)

### 2.1 프로젝트 생성

Supabase Dashboard ([app.supabase.com](https://app.supabase.com)):

- New Project → name `hd-poc-prod` (또는 staging) → region **Northeast Asia (Tokyo)** → DB password 강한 값
- 생성 후: Project ref (예: `abc12def34gh56`)

### 2.2 CLI 연결

```powershell
npm install -g supabase
supabase login
supabase link --project-ref <REF> --password <DB_PWD>
```

### 2.3 마이그레이션 일괄 적용 (11개)

Supabase는 기본적으로 `supabase/migrations/`를 찾음. 본 repo는 `C_Common/supabase/migrations/`. supabase CLI를 그 폴더에서 실행:

```powershell
cd C_Common\supabase
supabase db push --linked --include-all
```

순서: `001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011`.

### 2.4 Supabase secrets

```powershell
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
supabase secrets set ANTHROPIC_MODEL_PRIMARY=claude-opus-4-7
supabase secrets set VOICE_JWT_SECRET=$(openssl rand -hex 32)
supabase secrets set VOICE_JWT_ISSUER=hd-poc
supabase secrets set VOICE_JWT_EVENT=ctt_moscow_2026
supabase secrets set ADMIN_EMAIL_DOMAINS=hd.com,gridge.co.kr
supabase secrets set LOG_LEVEL=info
# SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 는 Edge Function에 자동 주입됨
```

### 2.5 Edge Function 배포 (16개)

```powershell
$REF = "<your-prod-ref>"

# S_Sensor (7)
cd S_Sensor\backend
supabase functions deploy --project-ref $REF --no-verify-jwt `
  captures-chunks captures-finalize normalize-worker `
  admin-captures admin-clusters admin-field-edit admin-normalize-trigger

# V_Voice (6)
cd ..\..\V_Voice\backend
supabase functions deploy --project-ref $REF --no-verify-jwt `
  responses-receive voice-responses voice-aggregates voice-csv-export `
  studio-build-survey studio-deploy

# U_Unified (2)
cd ..\..\U_Unified\backend
supabase functions deploy --project-ref $REF --no-verify-jwt `
  admin-leads admin-leads-detail

# T_Test (1)
cd ..\..\T_Test\backend
supabase functions deploy --project-ref $REF --no-verify-jwt `
  admin-test-summary
```

### 2.6 pg_cron 등록 (Supabase Dashboard SQL Editor)

005·007·002 마이그레이션 주석 블록 참조. 핵심 3개:

```sql
-- 1) Idempotency 만료 정리 (5분)
SELECT cron.schedule('cleanup_idempotency', '*/5 * * * *',
  $$SELECT cleanup_idempotency_expired();$$);

-- 2) normalize-worker 트리거 (1분)
SELECT cron.schedule('normalize_pump', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://<REF>.supabase.co/functions/v1/normalize-worker',
    headers := jsonb_build_object('Authorization', 'Bearer <service_role_key>', 'Content-Type','application/json'),
    body   := jsonb_build_object('batch_size', 5)
  );
$$);

-- 3) 30일 자동 삭제 (3am)
SELECT cron.schedule('delete_old_captures', '0 3 * * *', $$
  DELETE FROM captures WHERE created_at < now() - interval '30 days';
  DELETE FROM storage.objects WHERE bucket_id = 'captures'
    AND created_at < now() - interval '30 days';
$$);
```

### 2.7 Admin 사용자 등록

```sql
-- HD 검토자 이메일을 사전 등록 (Magic Link 발송 후 가입)
INSERT INTO auth.users (email) VALUES ('kim@hd.com'), ('lee@hd.com')
ON CONFLICT (email) DO NOTHING;
```

또는 Dashboard → Authentication → Users → Invite.

---

## 3. Phase 3 — Fly.io (Admin Next.js · Tokyo)

### 3.1 Fly CLI 설치·로그인

```powershell
iwr https://fly.io/install.ps1 -useb | iex
flyctl auth login
```

### 3.2 앱 생성·시크릿

```powershell
cd "f:\2_work\2_소프트스퀘어드내부\6_aiops\16_hd\hd-hyundai-poc-prd-v1\hd-hyundai-poc"

flyctl apps create hd-poc-admin --org gridge --no-deploy

flyctl secrets set --app hd-poc-admin `
  NEXT_PUBLIC_SUPABASE_URL=https://<REF>.supabase.co `
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> `
  NEXT_PUBLIC_API_BASE=https://<REF>.supabase.co/functions/v1 `
  NEXT_PUBLIC_SITE_URL=https://hd-poc-admin.fly.dev
```

### 3.3 첫 배포

```powershell
# fly.toml은 S_Sensor/admin/ — 빌드 컨텍스트는 repo 루트
flyctl deploy --config S_Sensor/admin/fly.toml --remote-only
```

빌드 단계:
1. `Dockerfile` deps 단계 → npm ci
2. builder 단계 → `npm run build -w @hd/sensor-admin` (Next.js standalone)
3. runner 단계 → `node S_Sensor/admin/server.js` (port 3000)

성공하면 `https://hd-poc-admin.fly.dev` 가 열림.

### 3.4 Supabase Auth callback 등록

Supabase Dashboard → Authentication → URL Configuration:
- **Site URL**: `https://hd-poc-admin.fly.dev`
- **Redirect URLs**: `https://hd-poc-admin.fly.dev/**`

이렇게 해야 Magic Link 메일의 링크가 정상 동작.

---

## 4. Phase 4 — Static surfaces

Dealer HTML · Visitor PWA · _preview 갤러리는 정적 자산. **Supabase Storage** 또는 **Fly.io static** 또는 같은 Next.js 앱 안에서 서빙.

### 4.1 옵션 A — Fly.io 같은 앱의 `/public` 으로 (간단)

```powershell
# Next.js public 디렉토리에 정적 surface 복사 후 push
New-Item -ItemType Directory -Force S_Sensor/admin/public/dealer
Copy-Item V_Voice/dealer/index.html  S_Sensor/admin/public/dealer/index.html

New-Item -ItemType Directory -Force S_Sensor/admin/public/visitor
Copy-Item V_Voice/visitor/* S_Sensor/admin/public/visitor/ -Recurse

# API_BASE inline 주입 — Next.js public에서 서빙 시 html 안 <script>에 직접 박기
# 예: dealer/index.html 맨 앞 <head> 안:
#   <script>window.HD_API_BASE='https://<REF>.supabase.co/functions/v1';</script>
```

배포 후:
- Dealer: `https://hd-poc-admin.fly.dev/dealer/` → QR 발급 시 이 URL 사용
- Visitor: `https://hd-poc-admin.fly.dev/visitor/`

### 4.2 옵션 B — Supabase Storage public bucket

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('hosting', 'hosting', true);
```

```powershell
supabase storage cp ./V_Voice/dealer/index.html  ss://hosting/dealer/index.html
supabase storage cp ./V_Voice/visitor            ss://hosting/visitor --recursive
```

URL: `https://<REF>.supabase.co/storage/v1/object/public/hosting/dealer/index.html`.

---

## 5. Phase 5 — R_20 토큰·QR 발급 (출장 전)

```powershell
cd "f:\2_work\2_소프트스퀘어드내부\6_aiops\16_hd\hd-hyundai-poc-prd-v1\hd-hyundai-poc"

# .env.local 작성 — DEALER_BASE_URL 은 Dealer 정적 서빙 URL
Copy-Item R_Runtime/r20/.env.example R_Runtime/r20/.env.local
# .env.local 채우기

# 일괄 발급 (CSV 한 줄당 dealer_id)
@'
dealer_001
dealer_002
dealer_003
'@ | Set-Content dealers.csv

npm install
npm run issue-batch -w @hd/r20 -- --csv dealers.csv --event ctt_moscow_2026 --ttl 120
# → R_Runtime/r20/out/ctt_moscow_2026_dealer_001.{png,svg} ...
```

PNG를 부스 태블릿 옆에 인쇄·부착. **out/ 폴더는 .gitignore에 포함됨** — commit 안 됨.

---

## 6. Phase 6 — Smoke test (실 환경)

```powershell
# T_Test runner를 실 환경에 연결
Copy-Item T_Test/runner/.env.example T_Test/runner/.env.local
# SUPABASE_URL/SERVICE_ROLE_KEY/VOICE_JWT_SECRET 채우기 (prod 환경)

npm run all -w @hd/t-test
```

기대 출력:
```
✓ run-t04 — exit 0
✓ run-t05 — exit 0
✓ run-t06 — exit 0
```

Admin 로그인 → `/t-test` → **8/9 이상 통과** 확인.

---

## 7. Phase 7 — D-day (시연) 체크리스트

| 점검 | 위치 |
|---|---|
| ☐ `https://hd-poc-admin.fly.dev/` 접속 OK | Fly.io |
| ☐ Magic Link 가입 → `/leads` 표시 OK | Supabase Auth |
| ☐ `/dealer/?token=<jwt>` 진입 → 설문 OK | Static (4.1 or 4.2) |
| ☐ `/visitor/` Add-to-Home OK | PWA |
| ☐ Chrome Extension `config.js` 작성 → `chrome://extensions` 로드 | 로컬 |
| ☐ Extension popup `큐 0` 표시 OK | Sensor |
| ☐ 직접 Bitrix24 caps 3장 흘림 → /captures-chunks 200 OK | Supabase logs |
| ☐ pg_cron `normalize_pump` 마지막 실행 ≤ 1분 전 | Supabase Dashboard |
| ☐ T_Test runner — `npm run all` 모두 passed | T_08 verdict |
| ☐ Anthropic 잔액 OK | Anthropic Console |

---

## 8. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| Edge Function 502 | secret 미설정 | `supabase secrets list` 확인 |
| Magic Link 클릭해도 anonymous | Site URL 미등록 | Dashboard → Authentication → URL config |
| `/normalize-worker` 호출 실패 | pg_cron service_role 누락 | `current_setting('app.service_role_key')` 설정 |
| Russia 측 도달 X | DNS 또는 ISP throttle | Fly.io fallback URL로 Extension config.js 갱신 |
| Public repo에 시크릿 commit | 사고 발생 | 즉시 키 회수 (SECURITY.md § 키 회전) + history rewrite (`git filter-repo`) |

---

## 9. 참조

- 호스팅 정책 — `C_Common/C_01_Hosting.md`
- 보안 — `SECURITY.md` · `C_Common/C_07_보안_법무.md`
- 인증 4종 — `C_Common/C_04_인증.md`
- T_08 통과 판정 — `T_Test/CLAUDE.md`
