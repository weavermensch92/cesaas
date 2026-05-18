#!/usr/bin/env -S node --import=tsx
/**
 * T_05 Voice E2E — Dealer Bearer + Visitor Anonymous → /responses-receive.
 *
 * 가설:
 *   V_가설 (응답 자산화): responses · response_answers INSERT, segment 매칭
 *   H_채널통합            : 동일 entity_id가 Sensor 측과 매핑되는지는 T_06 (여기서는 segment·NPS만)
 *
 * Usage:
 *   npm run t05 -w @hd/t-test
 */

import { CONFIG } from '../lib/config.js';
import { fail, finishRun, pass, startRun } from '../lib/assert.js';
import { http } from '../lib/http.js';
import { signDealerToken } from '../lib/jwt.js';
import { db } from '../lib/db.js';
import {
  DEALER_FIXTURE_MINING,
  VISITOR_FIXTURE_CONSTRUCTION,
  expectedSegment,
  makeDealerAnswers,
  makeVisitorAnswers,
} from '../lib/fixtures.js';
import { randomUUID } from 'node:crypto';

interface PostResult { responseId: string; segment: string | null }

async function main(): Promise<void> {
  const run = await startRun({ suite: 'T_05', scenario: 'voice_full' });

  // ----- Dealer: Bearer JWT -----
  let token;
  try {
    token = await signDealerToken({ dealerId: `t_test_dealer_${run.id.slice(0, 6)}`, event: CONFIG.event });
    await pass(run, { step: 'auth', name: 'Dealer JWT 발급', actual: { jti: token.jti, exp: token.exp } });
  } catch (e) {
    await skip_and_finish(run, e instanceof Error ? e.message : String(e));
    return;
  }

  const dealerAxis = DEALER_FIXTURE_MINING;
  const dealerExpectedSeg = expectedSegment(dealerAxis);
  const dealerResult = await postDealerResponse(run, token.jwt, dealerAxis, dealerExpectedSeg);

  // ----- Visitor: Anonymous device_id -----
  const visitorAxis = VISITOR_FIXTURE_CONSTRUCTION;
  const visitorExpectedSeg = expectedSegment(visitorAxis);
  const deviceId = randomUUID();
  const visitorResult = await postVisitorResponse(run, deviceId, visitorAxis, visitorExpectedSeg);

  // ----- Visitor quota: 24h 6번째 시도 = 429 -----
  // Edge Function의 visitor_quota_remaining(per_day=5) — 5번 채우고 6번째에 rate_limited 확인.
  // 시간 한계로 5회만 실 송출 + 6번째는 OPTIONAL — env 플래그.
  if (process.env['T_TEST_QUOTA'] === 'true') {
    await testVisitorQuota(run, visitorAxis, visitorExpectedSeg);
  } else {
    await pass(run, { step: 'visitor_quota', name: '24h quota 테스트 skip (T_TEST_QUOTA=true로 활성)' });
  }

  // Cleanup
  if (CONFIG.cleanup) {
    const ids = [dealerResult?.responseId, visitorResult?.responseId].filter(Boolean) as string[];
    if (ids.length > 0) {
      await db().from('response_answers').delete().in('response_id', ids);
      await db().from('responses').delete().in('id', ids);
    }
    if (CONFIG.jwtSecret) {
      await db().from('voice_dealer_tokens').delete().eq('jti', token.jti);
    }
  }

  const result = await finishRun(run);
  process.exit(result.status === 'passed' ? 0 : 1);
}

async function postDealerResponse(run: Awaited<ReturnType<typeof startRun>>, jwt: string, axis: ReturnType<typeof DEALER_FIXTURE_MINING extends infer T ? () => T : never>['valueOf'] extends never ? never : never, expectedSeg: string): Promise<PostResult | null> {
  // 타입 회피 — axis는 그냥 객체
  const answers = makeDealerAnswers(DEALER_FIXTURE_MINING);
  const payload = {
    survey_id: 'survey_v1_dealer',
    respondent_type: 'dealer' as const,
    language: 'ru',
    nps: 9,
    future_subscription: true,
    consent_data_collection: true,
    segment: 'mining',
    segment_method: 'client_rule',
    segment_confidence: 1.0,
    axis_data: DEALER_FIXTURE_MINING,
    captured_at: new Date().toISOString(),
    answers,
  };

  const bodyStr = JSON.stringify(payload);
  const res = await http({
    method: 'POST', path: '/responses-receive',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `t_test_dealer_${run.id}_${Date.now()}`,
    },
    body: bodyStr,
  });

  if (res.status !== 200) {
    await fail(run, {
      step: 'dealer', name: 'POST /responses-receive (dealer)',
      hypothesis: 'V_가설', actual: { status: res.status, body: res.bodyJson },
      durationMs: res.durationMs, error: `http_${res.status}`,
    });
    return null;
  }

  const body = res.bodyJson as { id?: string; segment?: string };
  const responseId = body.id ?? '';
  await pass(run, {
    step: 'dealer', name: 'POST /responses-receive (dealer) 200',
    hypothesis: 'V_가설', actual: body, durationMs: res.durationMs,
    metric: { name: 'latency_ms', value: res.durationMs },
  });

  // 서버 측 segment 재계산 검증
  if (body.segment === expectedSeg) {
    await pass(run, {
      step: 'dealer_segment', name: `서버 segment === ${expectedSeg}`,
      hypothesis: 'V_가설', expected: expectedSeg, actual: body.segment,
    });
  } else {
    await fail(run, {
      step: 'dealer_segment', name: `서버 segment === ${expectedSeg}`,
      hypothesis: 'V_가설', expected: expectedSeg, actual: body.segment,
    });
  }

  // DB row + answers 확인
  if (responseId) {
    const { data: r } = await db().from('responses').select('id, dealer_id, segment, nps, axis_data').eq('id', responseId).maybeSingle();
    const { count } = await db().from('response_answers').select('id', { count: 'exact', head: true }).eq('response_id', responseId);
    if (r && (count ?? 0) === answers.length) {
      await pass(run, {
        step: 'dealer_db', name: 'responses + answers row 정합성',
        hypothesis: 'V_가설',
        actual: { response: r, answers_count: count },
        metric: { name: 'answers_count', value: count ?? 0 },
      });
    } else {
      await fail(run, {
        step: 'dealer_db', name: 'responses + answers row 정합성',
        hypothesis: 'V_가설',
        actual: { response: r, answers_count: count, expected_answers: answers.length },
      });
    }
  }

  return { responseId, segment: body.segment ?? null };
}

async function postVisitorResponse(run: Awaited<ReturnType<typeof startRun>>, deviceId: string, _axis: typeof VISITOR_FIXTURE_CONSTRUCTION, expectedSeg: string): Promise<PostResult | null> {
  const answers = makeVisitorAnswers(VISITOR_FIXTURE_CONSTRUCTION);
  const payload = {
    survey_id: 'survey_v1_visitor',
    respondent_type: 'visitor' as const,
    language: 'ru',
    nps: 8,
    future_subscription: false,
    consent_data_collection: true,
    segment: 'construction_heavy',
    segment_method: 'client_rule',
    segment_confidence: 1.0,
    axis_data: VISITOR_FIXTURE_CONSTRUCTION,
    captured_at: new Date().toISOString(),
    answers,
    contact_opted_in: false,
  };

  const res = await http({
    method: 'POST', path: '/responses-receive',
    headers: {
      'X-Device-ID': deviceId,
      'Content-Type': 'application/json',
      'Idempotency-Key': `t_test_visitor_${run.id}_${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status !== 200) {
    await fail(run, {
      step: 'visitor', name: 'POST /responses-receive (visitor anonymous)',
      hypothesis: 'V_가설', actual: { status: res.status, body: res.bodyJson },
      durationMs: res.durationMs, error: `http_${res.status}`,
    });
    return null;
  }

  const body = res.bodyJson as { id?: string; segment?: string };
  const responseId = body.id ?? '';
  await pass(run, {
    step: 'visitor', name: 'POST /responses-receive (visitor) 200',
    hypothesis: 'V_가설', actual: body, durationMs: res.durationMs,
    metric: { name: 'latency_ms', value: res.durationMs },
  });

  if (body.segment === expectedSeg) {
    await pass(run, {
      step: 'visitor_segment', name: `서버 segment === ${expectedSeg}`,
      hypothesis: 'V_가설', expected: expectedSeg, actual: body.segment,
    });
  } else {
    await fail(run, {
      step: 'visitor_segment', name: `서버 segment === ${expectedSeg}`,
      hypothesis: 'V_가설', expected: expectedSeg, actual: body.segment,
    });
  }

  // opt-in=false → contact_* NULL 검증
  if (responseId) {
    const { data: r } = await db().from('responses')
      .select('contact_opted_in, contact_name, contact_phone, contact_email')
      .eq('id', responseId).maybeSingle();
    const piiClean = r && r.contact_opted_in === false
      && r.contact_name == null && r.contact_phone == null && r.contact_email == null;
    if (piiClean) {
      await pass(run, {
        step: 'visitor_pii', name: 'opt-in=false → contact_* NULL',
        hypothesis: 'V_가설', actual: r,
      });
    } else {
      await fail(run, {
        step: 'visitor_pii', name: 'opt-in=false → contact_* NULL',
        hypothesis: 'V_가설', actual: r,
      });
    }
  }

  return { responseId, segment: body.segment ?? null };
}

async function testVisitorQuota(run: Awaited<ReturnType<typeof startRun>>, _axis: typeof VISITOR_FIXTURE_CONSTRUCTION, _expectedSeg: string): Promise<void> {
  const deviceId = randomUUID();
  const answers = makeVisitorAnswers(VISITOR_FIXTURE_CONSTRUCTION);
  const baseBody = {
    survey_id: 'survey_v1_visitor',
    respondent_type: 'visitor' as const,
    language: 'ru',
    nps: 7, future_subscription: false, consent_data_collection: true,
    segment: 'construction_heavy', segment_method: 'client_rule', segment_confidence: 1.0,
    axis_data: VISITOR_FIXTURE_CONSTRUCTION,
    captured_at: new Date().toISOString(),
    answers, contact_opted_in: false,
  };
  // 5번 보내고 6번째 = 429
  const statuses: number[] = [];
  const responseIds: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const res = await http({
      method: 'POST', path: '/responses-receive',
      headers: {
        'X-Device-ID': deviceId, 'Content-Type': 'application/json',
        'Idempotency-Key': `t_test_quota_${run.id}_${i}`,
      },
      body: JSON.stringify({ ...baseBody, captured_at: new Date().toISOString() }),
    });
    statuses.push(res.status);
    const id = (res.bodyJson as { id?: string } | null)?.id;
    if (id) responseIds.push(id);
  }
  const last = statuses[5];
  if (last === 429) {
    await pass(run, {
      step: 'visitor_quota', name: '24h quota = 5 — 6번째 시도 429',
      hypothesis: 'V_가설', actual: { statuses }, metric: { name: 'rate_limited_at', value: 6 },
    });
  } else {
    await fail(run, {
      step: 'visitor_quota', name: '24h quota = 5 — 6번째 시도 429',
      hypothesis: 'V_가설', expected: 429, actual: { statuses },
    });
  }
  // cleanup
  if (responseIds.length > 0 && CONFIG.cleanup) {
    await db().from('response_answers').delete().in('response_id', responseIds);
    await db().from('responses').delete().in('id', responseIds);
  }
}

async function skip_and_finish(run: Awaited<ReturnType<typeof startRun>>, reason: string): Promise<void> {
  await fail(run, { step: 'auth', name: 'Dealer JWT 발급', error: reason });
  await finishRun(run);
  process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
