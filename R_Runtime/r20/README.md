# R_20 — GridgeTools (위버 전용)

> 하네스 2 영역. **위버만 사용** (IP allowlist + basic auth로 보호). HD 운영진은 사용 X.

## 책임

| 도구 | 본질 |
|---|---|
| `issue-dealer-token` | Dealer Bearer JWT 단건 발급 + QR PNG/SVG |
| `issue-batch`        | CSV 또는 콤마 입력으로 여러 dealer 일괄 발급 |
| (예정) `publish-rule` | YAML 파일 → `publish_rule()` RPC로 R_10 정정 |
| (예정) `retrigger-batch` | `cluster_ids` 일괄 재정규화 |

## 사용 (출장 전 발급)

```powershell
# 1) 의존성 설치
npm install

# 2) .env.local 생성 (R_Runtime/r20/.env.local)
#    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#    VOICE_JWT_SECRET, VOICE_JWT_ISSUER, DEALER_BASE_URL

# 3a) 단건 발급
npm run issue-token -w @hd/r20 -- --dealer dealer_001 --event ctt_moscow_2026

# 3b) CSV 일괄 (한 줄에 dealer_id 하나, # 으로 주석)
echo "dealer_001`ndealer_002`ndealer_003" | Set-Content dealers.csv
npm run issue-batch -w @hd/r20 -- --csv dealers.csv --event ctt_moscow_2026 --ttl 96

# 4) 결과
#  - DB voice_dealer_tokens row INSERT
#  - QR 파일: R_Runtime/r20/out/{event}_{dealer_id}.{png,svg}
#  - stdout JSON: jti, url, expires_at
```

## 출력 예 (단건)

```json
{
  "ok": true,
  "jti": "f8e7d6c5-...",
  "dealer_id": "dealer_001",
  "event": "ctt_moscow_2026",
  "expires_at": "2026-05-27T08:00:00.000Z",
  "url": "https://dealer.example/?token=eyJhbGciOiJIUzI1NiJ9...",
  "qr_png": "/.../R_Runtime/r20/out/ctt_moscow_2026_dealer_001.png",
  "qr_svg": "/.../R_Runtime/r20/out/ctt_moscow_2026_dealer_001.svg"
}
```

QR PNG는 HD Trust Blue 색 + 흰 배경. 인쇄해서 부스 태블릿 옆에 부착.

## 회수

```sql
-- 토큰 revoke
UPDATE voice_dealer_tokens SET revoked_at = now() WHERE jti = '<jti>';
-- JWT는 stateless이므로 백엔드 측에서 jti 화이트리스트 확인 필요할 때만.
-- v1 단순화: 만료(expires_at)에 의존.
```

## 보안

- VOICE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY는 .gitignore.
- R_20 도구 실행은 위버 본인 머신 또는 IP allowlist + basic auth 서버에서만.

상세 — `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/C_Common/C_04_인증.md` § 6.
