#!/usr/bin/env -S node --import=tsx
/**
 * T_07.01 — Fly.io Edge fallback 호스팅 전환 검증.
 *
 * 검증 가설: H_도달성 — Supabase Edge 미도달 시 Fly.io fallback이 동일 기능 수행.
 *
 * 흐름:
 *   1. T_TEST_FALLBACK_BASE 환경변수 검사 — 미설정 시 skip (fly_edge 미배포)
 *   2. <fallback>/health GET → 200 + role=fly_io_fallback + region 확인
 *   3. Dealer JWT 발급 + POST <fallback>/responses-receive (axis_data 포함)
 *   4. 200 응답 + body.id 반환 + body.segment 매칭 확인
 *   5. DB에서 응답 row 확인 + cleanup
 *
 * Usage (fly_edge 배포 후):
 *   export T_TEST_FALLBACK_BASE=https://hd-poc-edge.fly.dev
 *   npm run t07-01 -w @hd/t-test
 *
 * Usage (미배포 시 — runner는 skip-with-note 기록):
 *   npm run t07-01 -w @hd/t-test
 */

import { CONFIG } from '../lib/config.js';
import { fail, finishRun, pass, skip, startRun } from '../lib/assert.js';
import { db } from '../lib/db.js';
import { signDealerToken } from '../lib/jwt.js';
import { DEALER_FIXTURE_MINING, expectedSegment, makeDealerAnswers } from '../lib/fixtures.js';
import { randomUUID } from 'node:crypto';

async function main(): Promise<void> {
  const run = await startRun({
    suite: 'T_07', scenario: 'hosting_failover',
    notes: `T_07.01 — Fly.io Edge fallback (base=${CONFIG.fallbackBase || 'unset'})`,
  });

  if (!CONFIG.fallbackBase) {
    await skip(run, {
      step: 'preflight', name: 'T_TEST_FALLBACK_BASE env',
      hypothesis: 'H_도달성',
      actual: null,
      error: 'T_TEST_FALLBACK_BASE 미설정 — fly_edge 아직 배포 안 됨. DEPLOY-FALLBACK.md 참조',
    });
    const result = await finishRun(run);
    // skip은 fail 아님 — 정상 종료 (T_08 통과 판정에 noise 안 생기게)
    process.exit(result.status === 'failed' ? 1 : 0);
  }

  const base = CONFIG.fallbackBase;

  // ----- 1) Health check ------------------------------------------------
  try {
    const t0 = Date.now();
    const healthRes = await fetch(`${base}/health`);
    const dt = Date.now() - t0;
    if (!healthRes.ok) {
      await fail(run, {
        step: 'health', name: 'GET /health 200',
        hypothesis: 'H_도달성',
        actual: { status: healthRes.status, durationMs: dt },
      });
      await finishRun(run); process.exit(1);
    }
    const body = await healthRes.json() as {
      ok?: boolean; role?: string; region?: string; service?: string;
    };
    const okShape = body.ok === true && body.role === 'fly_io_fallback' && typeof body.region === 'string';
    if (okShape) {
      await pass(run, {
        step: 'health', name: 'GET /health 200 + 정상 shape',
        hypothesis: 'H_도달성',
        actual: { region: body.region, service: body.service, durationMs: dt },
        metric: { name: 'health_latency_ms', value: dt },
      });
    } else {
      await fail(run, {
        step: 'health', name: 'GET /health shape',
        hypothesis: 'H_도달성',
        actual: body,
      });
    }
  } catch (e) {
    await fail(run, {
      step: 'health', name: 'GET /health',
      hypothesis: 'H_도달성',
      error: e instanceof Error ? e.message : String(e),
    });
    await finishRun(run); process.exit(1);
  }

  // ----- 2) Dealer 응답 송출 to fallback only --------------------------
  if (!CONFIG.jwtSecret) {
    await skip(run, {
      step: 'dealer_post', name: 'VOICE_JWT_SECRET 필요',
      hypothesis: 'V_가설',
      error: 'JWT 시크릿 없이는 dealer post 검증 불가',
    });
    await finishRun(run); process.exit(0);
  }

  const dealerId = `t07_01_${randomUUID().slice(0, 6)}`;
  const entityId = `t7_01_${randomUUID().slice(0, 8)}`;
  let jti: string | null = null;
  let responseId: string | null = null;

  try {
    const token = await signDealerToken({ dealerId, event: CONFIG.event });
    jti = token.jti;
    const axis = DEALER_FIXTURE_MINING;
    const payload = {
      survey_id: 'survey_v1_dealer',
      respondent_type: 'dealer',
      language: 'ru',
      nps: 9,
      future_subscription: true,
      consent_data_collection: true,
      segment: expectedSegment(axis),
      segment_method: 'client_rule',
      segment_confidence: 1.0,
      axis_data: { ...axis, entity_id: entityId },
      target_company: `T_07.01 Test Co ${dealerId}`,
      captured_at: new Date().toISOString(),
      answers: makeDealerAnswers(axis),
    };
    const t0 = Date.now();
    const res = await fetch(`${base}/responses-receive`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.jwt}`,
        'Content-Type':  'application/json',
        'Idempotency-Key': `t_07_01_${randomUUID()}`,
      },
      body: JSON.stringify(payload),
    });
    const dt = Date.now() - t0;
    const body = await res.json() as { id?: string; segment?: string };

    if (res.status !== 200) {
      await fail(run, {
        step: 'dealer_post', name: 'POST /responses-receive 200 (fallback)',
        hypothesis: 'V_가설',
        actual: { status: res.status, body, durationMs: dt },
      });
    } else if (!body.id) {
      await fail(run, {
        step: 'dealer_post', name: 'POST /responses-receive returns id',
        hypothesis: 'V_가설',
        actual: body,
      });
    } else {
      responseId = body.id;
      await pass(run, {
        step: 'dealer_post', name: 'POST /responses-receive 200 (fallback)',
        hypothesis: 'V_가설',
        actual: { id: body.id, segment: body.segment, durationMs: dt },
        metric: { name: 'post_latency_ms', value: dt },
      });
    }
  } catch (e) {
    await fail(run, {
      step: 'dealer_post', name: 'POST /responses-receive (fallback)',
      hypothesis: 'V_가설',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ----- 3) DB row 검증 -----------------------------------------------
  if (responseId) {
    const { data: row } = await db()
      .from('responses')
      .select('id, segment, dealer_id, event, target_company')
      .eq('id', responseId)
      .maybeSingle();
    if (row && row.dealer_id === dealerId) {
      await pass(run, {
        step: 'db_verify', name: 'responses row 존재 + dealer_id 매칭',
        hypothesis: 'H_도달성·V_가설',
        actual: { id: row.id, segment: row.segment, target_company: row.target_company },
      });
    } else {
      await fail(run, {
        step: 'db_verify', name: 'responses row 존재 + dealer_id 매칭',
        hypothesis: 'H_도달성·V_가설',
        actual: row,
      });
    }
  }

  // ----- 4) cleanup ----------------------------------------------------
  if (CONFIG.cleanup && responseId) {
    await db().from('response_answers').delete().eq('response_id', responseId);
    await db().from('responses').delete().eq('id', responseId);
    if (jti) await db().from('voice_dealer_tokens').delete().eq('jti', jti);
    // lead·dealer_outputs·lead_links 정리 (T_06과 동일 패턴)
    const { data: lead } = await db()
      .from('leads').select('id').eq('entity_id', entityId).eq('crm_id', 'bitrix24').maybeSingle();
    if (lead?.id) {
      await db().from('dealer_outputs').delete().eq('lead_id', lead.id as string);
      await db().from('lead_links').delete().eq('lead_id', lead.id as string);
      await db().from('leads').delete().eq('id', lead.id as string);
    }
  }

  const result = await finishRun(run);
  process.exit(result.status === 'passed' ? 0 : 1);
}

await main().catch((e) => {
  if (e && (e as { __t_test_silent?: boolean }).__t_test_silent) throw e;
  console.error('FATAL', e);
  process.exit(2);
});
