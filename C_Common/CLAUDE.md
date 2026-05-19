# C_Common — CLAUDE.md (구현)

> **모듈**: 공통 기반 — Supabase·API·인증·LLM·R_10 룰 로더·디자인 시스템·로깅.
> **상위**: `../CLAUDE.md`
> **하네스 분류**: 하네스 1 (공통)
> **하네스 룰 원본**: `../../../hd-hyundai-poc-harness-v1/hd-hyundai-poc/C_Common/CLAUDE.md`
> **v0.1 상태**: 골격 (Supabase 마이그레이션 · @hd/core · @hd/design · R_10 YAML 스텁)

---

## 0. 목차

| 키워드 | 섹션 |
|---|---|
| 정체성 | § 1 |
| 키워드 → 위치 | § 2 |
| 파일 카탈로그 | § 3 |
| 사용 패턴 (예시) | § 4 |
| 핵심 정책 (변경 절대 금지) | § 5 |
| 후속 작업 | § 6 |
| 변경 이력 | § 7 |

---

## 1. 정체성

**모든 트랙(S·V·U·T·R) 공통 인프라**. 한 곳에서 정의 → 모든 모듈 일관 적용.

| 자산 | 책임 |
|---|---|
| `supabase/` | DB 스키마·Storage·RLS·pg_cron |
| `packages/core/` | TS 공유 라이브러리 (errors·pagination·idempotency·hmac·auth·logger·rules·llm) |
| `packages/design/` | hd-design CSS + i18n (ko/ru) |
| `r_10_rules/` | 하네스 2 룰 YAML (R_10.01 · .05 · .06 · .07 · .08) |

---

## 2. 키워드 → 위치

| 키워드 | 파일 |
|---|---|
| Supabase config·로컬 부팅 | `supabase/config.toml` |
| 공통 ENUM · updated_at 트리거 · auth_role | `supabase/migrations/001_common.sql` |
| Idempotency 24h · HMAC nonce 5m | `supabase/migrations/006_idempotency.sql` |
| API error 포맷·status 매핑 | `packages/core/src/errors.ts` |
| Cursor pagination·base64(t+i) | `packages/core/src/pagination.ts` |
| Idempotency 룩업·기록·SHA-256 | `packages/core/src/idempotency.ts` |
| HMAC 서명 검증·timestamp drift·nonce | `packages/core/src/hmac.ts` |
| Bearer JWT (Dealer)·Anonymous (Visitor)·Admin | `packages/core/src/auth.ts` |
| 구조화 JSON 로거·request_id child | `packages/core/src/logger.ts` |
| R_10 YAML 로더·hot reload | `packages/core/src/rules.ts` |
| Anthropic 클라이언트·지수 백오프·callRule | `packages/core/src/llm.ts` |
| HD CI 토큰·색상·타이포 | `packages/design/src/styles/colors_and_type.css` |
| 컴포넌트 클래스 (.hd-topbar 등) | `packages/design/src/styles/styles.css` |
| ko/ru 사전·tx·makeT | `packages/design/src/i18n/index.ts` |
| Prompt Templates | `r_10_rules/R_10.06_PromptTemplates.yaml` |
| Classification (segment·priority·screen_kind) | `r_10_rules/R_10.05_Classification.yaml` |
| Dealer Playbook | `r_10_rules/R_10.07_DealerOutput.yaml` |
| Survey Build Prompt (Studio) | `r_10_rules/R_10.08_SurveyBuildPrompt.yaml` |
| DataPointToQuestion (Studio 추가 질문 보강) | `r_10_rules/R_10.09_DataPointToQuestion.yaml` |
| Lead Scoring 가중치 | `r_10_rules/R_10.01_LeadScoring.yaml` |
| Lead Quality 등급 (A/B/C/D) | `r_10_rules/R_10.02_LeadQuality.yaml` |

---

## 3. 파일 카탈로그

| 파일 | 상태 |
|---|---|
| `supabase/config.toml` | ✓ |
| `supabase/migrations/001_common.sql` | ✓ |
| `supabase/migrations/006_idempotency.sql` | ✓ |
| `supabase/migrations/002_sensor.sql` | (S_Sensor 라운드) |
| `supabase/migrations/003_voice.sql` | (V_Voice 라운드) |
| `supabase/migrations/004_unified.sql` | (U_Unified 라운드) |
| `supabase/migrations/005_runtime.sql` | (R_Runtime 라운드) |
| `packages/core/src/*` | ✓ 8 modules |
| `packages/design/src/*` | ✓ CSS + i18n |
| `r_10_rules/*.yaml` | ✓ 7 룰 시드 (R_10.01·.02·.05·.06·.07·.08·.09) |

---

## 4. 사용 패턴 (예시)

### 4.1 Edge Function — 캡쳐 수신 (S_20.01)

```ts
import {
  ApiError, toJsonResponse,
  verifyHmac,
  hashRequestBody, lookupIdempotency, recordIdempotency,
  loggerForRequest,
} from '@hd/core';
import { createClient } from '@supabase/supabase-js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

/**
 * serves: ['dealer']
 * direction: 'upward'
 * related_hypothesis: ['H1', 'H2']
 * harness: 1
 */
Deno.serve(async (req) => {
  const log = loggerForRequest(req).child({ route: '/v1/captures' });
  try {
    const body = await req.arrayBuffer();
    const bodyHash = await hashRequestBody(new Uint8Array(body));
    const identity = await verifyHmac(req, bodyHash, { db, loadKey: lookupExtensionKey });

    const idemKey = req.headers.get('idempotency-key');
    if (idemKey) {
      const hit = await lookupIdempotency(db, {
        key: idemKey,
        route: '/v1/captures',
        requestHash: bodyHash,
      });
      if (hit.hit) return new Response(JSON.stringify(hit.body), { status: hit.status });
    }

    // ... 실제 처리 ...
    const result = { id: crypto.randomUUID(), status: 'received', queued_at: new Date().toISOString() };

    if (idemKey) {
      await recordIdempotency(db, {
        key: idemKey, route: '/v1/captures', requestHash: bodyHash,
        status: 200, body: result,
      });
    }
    log.info('capture received', { dealer_id: identity.dealerId });
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    log.error('capture failed', err);
    return toJsonResponse(err);
  }
});
```

### 4.2 LLM 호출 — Sensor 정규화 (S_30)

```ts
import { createLlmClient } from '@hd/core';

const llm = createLlmClient();
const result = await llm.callRule('R_10.06_PromptTemplates', 'sensor_13_fields', {
  images: clusterImages.slice(0, 5).map(toImageBlock),
});
const fields = JSON.parse(result.text);
```

### 4.3 Admin UI — 디자인 토큰 사용 (S_50)

```tsx
import '@hd/design/styles';
import { makeT, type Lang } from '@hd/design/i18n';

export function CapturesPage({ lang }: { lang: Lang }) {
  const t = makeT(lang);
  return (
    <div className="hd-app" data-density="balanced">
      <header className="hd-topbar">
        <span className="hd-logo">
          <span className="hd-logo-mark">H</span>
          {t('brand')} · {t('product')}
        </span>
        <span className="hd-crumb">{t('crumb_path')}</span>
      </header>
      <h1 className="hd-h1">{t('nav_captures')}</h1>
      {/* ... table with .hd-table ... */}
    </div>
  );
}
```

---

## 5. 핵심 정책 (변경 절대 금지)

| 정책 | 근거 |
|---|---|
| Supabase 단독 primary + Fly.io fallback | C_01_Hosting |
| Cloudflare 금지 (러시아 16KB throttle) | C_01_Hosting |
| `/v1` prefix · `{error,message,details}` · cursor | C_03_API_패턴 |
| HMAC drift 300s · nonce 1회용 (5분 TTL) | C_04_인증 |
| Idempotency-Key 24h · processed_events 캐시 | C_03_API_패턴 |
| Anthropic 단독 · `claude-opus-4-7` 기본 | C_05_LLM_정책 |
| 비동기 큐 (50s 제한 우회) — `status='pending_normalize'` | C_01_Hosting · C_05_LLM_정책 |
| 프롬프트 R_10.06 YAML 로드 — 하드코드 금지 | C_05_LLM_정책 § 6 |
| 30일 자동 삭제 (Storage·민감 PII) | C_07_보안_법무 |
| TLS 1.3 · CORS 화이트리스트 | C_07_보안_법무 |
| 모든 user-facing 문자열에 "현대" 표기 금지 — "HD" / "HD건설기계" | 본질 § 6 · CI § 4 |

---

## 6. 후속 작업

| 우선 | 영역 | 비고 |
|---|---|---|
| H | C_06 메트릭 emitter (Prometheus exposition) | logger와 연계 |
| H | C_08 GCP Secret Manager 어댑터 | env 추상화 |
| M | 002_sensor.sql · 003_voice.sql · 004_unified.sql · 005_runtime.sql | 각 모듈 라운드와 같이 |
| M | packages/design 공유 React 컴포넌트 (TopBar·FilterBar) | shared.jsx 포팅 |
| L | R_10 룰 본격 채움 (현재 모두 스텁) | 첫 호출 시점에 |

---

## 7. 변경 이력

| 시점 | 변경 |
|---|---|
| 2026-05-18 | v0.1 — 골격 (8 core modules · 5 R_10 stubs · 2 base migrations · 디자인 패키지) |
| 2026-05-19 | v0.2 — R_10.02 LeadQuality (A/B/C/D 임계 80/50/25) + R_10.09 DataPointToQuestion (Studio 추가 질문 보강 프롬프트) YAML 시드. 하네스 2 본질 R-002·R-009 PRD-03 § 4 충족 (Phase A — lib·publish·hot reload는 Phase B~D 후속) |
| 2026-05-19 | v0.3 — R_10.01·.02·.05·.06·.07·.08·.09 7개 YAML을 harness1 스키마(rule_id·version·harness·v1_v2·last_modified·modified_by + templates/rules/thresholds/voice_segment 평탄 배열)로 통일. core/llm.ts·V_Voice·S_Sensor shared/llm.ts callRule에 templates[promptKey] 접근 + 레거시 body[promptKey] 후방 호환. 018_reseed_r10_06_harness1_schema.sql 마이그레이션으로 DB rule_versions 갱신 (Phase B.2 + B.3) |
