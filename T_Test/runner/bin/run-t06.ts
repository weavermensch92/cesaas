#!/usr/bin/env -S node --import=tsx
/**
 * T_06 통합 E2E — Sensor + Voice가 같은 entity_id로 1 Lead에 응집되는지.
 *
 * 가설:
 *   H_채널통합 — 같은 entity_id 클러스터·응답 → 1 leads row, sensor_count≥1, voice_count≥1
 *   V_가설    — Voice 응답 정상 INSERT + segment 매칭
 *   H3        — 정규화 큐 진입 (LLM opt-in 시 normalized_fields(active) 까지)
 *
 * 흐름:
 *   1) HMAC 키 발급 + 같은 entity_id 3장 캡쳐 송출 (cluster 트리거)
 *   2) cluster.status가 'pending_normalize'·'normalizing'·'normalized' 중 하나가 될 때까지 폴
 *      - LLM opt-in 아니면 'pending_normalize' (worker 미실행) → cluster→lead 트리거가 안 됨
 *        → 테스트 위해 직접 upsert_lead_from_cluster RPC 호출
 *   3) Dealer 응답 송출 (axis_data.entity_id = 같은 값) → response→lead 트리거 자동
 *   4) leads row 확인:
 *      - sensor_count ≥ 1 · voice_count ≥ 1
 *      - segment 매칭 · score > 0 · priority 결정
 *      - dealer_outputs active 1개
 *      - lead_links 2건 (cluster + response)
 *   5) cleanup
 *
 * Usage:
 *   npm run t06 -w @hd/t-test [-- --llm]
 */

import { CONFIG } from '../lib/config.js';
import { fail, finishRun, pass, startRun } from '../lib/assert.js';
import { makeSensorFixture, expectedSegment, DEALER_FIXTURE_MINING } from '../lib/fixtures.js';
import {
  cleanupSensorFixture, provisionTestKey, revokeKey, sendAllChunks, sendFinalize,
} from '../lib/sensor-helpers.js';
import { postDealer } from '../lib/voice-helpers.js';
import { db } from '../lib/db.js';
import { randomUUID } from 'node:crypto';

interface CliArgs { llm?: 'true' | 'false' }
function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith('--')) { (out as Record<string, string>)[k] = v; i += 1; }
    else (out as Record<string, string>)[k] = 'true';
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const llmEnabled = (args.llm === 'true') || CONFIG.includeLlm;

  const run = await startRun({
    suite: 'T_06', scenario: 'unified_same_entity',
    notes: `same-entity sensor+voice · llm=${llmEnabled}`,
  });

  // 같은 entity_id 공유
  const entityId = `t6_${randomUUID().slice(0, 8)}`;
  const dealerId = `t_test_dealer_${run.id.slice(0, 6)}`;

  // 1) HMAC 키 + 3장 캡쳐 (모두 같은 entity_id)
  let key;
  try {
    key = await provisionTestKey();
    await pass(run, { step: 'provision', name: 'sensor_api_keys INSERT' });
  } catch (e) {
    await fail(run, { step: 'provision', name: 'sensor_api_keys INSERT', error: String((e as Error).message) });
    await finishRun(run); process.exit(1);
  }

  const fixtures = [
    makeSensorFixture({ dealerId, entityId }),
    makeSensorFixture({ dealerId, entityId }),
    makeSensorFixture({ dealerId, entityId }),
  ];

  let chunksOk = 0, chunksTotal = 0;
  for (const fx of fixtures) {
    const ch = await sendAllChunks(key, fx);
    chunksTotal += ch.statuses.length;
    chunksOk += ch.statuses.filter((s) => s === 200).length;
    const fin = await sendFinalize(key, fx, ch.totalChunks, ch.fullHashHex);
    if (fin.status !== 200) {
      await fail(run, { step: 'send', name: `finalize ${fx.captureId.slice(0,8)}`, hypothesis: 'H1', actual: fin });
    } else {
      await pass(run, { step: 'send', name: `finalize ${fx.captureId.slice(0,8)}`, hypothesis: 'H1', durationMs: fin.durationMs });
    }
  }
  await pass(run, {
    step: 'sensor_metric', name: 'chunk success', hypothesis: 'H1',
    metric: { name: 'success_rate', value: chunksTotal === 0 ? 0 : (chunksOk/chunksTotal)*100 },
  });

  // 2) cluster 생성 확인
  const { data: cluster } = await db()
    .from('entity_clusters')
    .select('id, status, image_count, normalized_fields_id')
    .eq('entity_id', entityId).eq('crm_id', 'bitrix24')
    .maybeSingle();
  if (!cluster) {
    await fail(run, { step: 'cluster', name: 'entity_clusters row exists', hypothesis: 'H3', actual: null });
    await teardown(key.keyId, fixtures);
    await finishRun(run); process.exit(1);
  }
  await pass(run, {
    step: 'cluster', name: 'entity_clusters row exists',
    hypothesis: 'H3', actual: { cluster_id: cluster.id, status: cluster.status, image_count: cluster.image_count },
    metric: { name: 'image_count', value: cluster.image_count as number },
  });

  // 3) normalize-worker 동작 — LLM opt-in이 아니면 직접 RPC 호출로 lead 응집까지 진행
  let normalizedSuccess = false;
  if (llmEnabled) {
    const startWait = Date.now();
    const deadline = startWait + CONFIG.normalizeTimeoutMs;
    while (Date.now() < deadline) {
      const { data: c } = await db()
        .from('entity_clusters')
        .select('status, normalized_fields_id')
        .eq('id', cluster.id as string)
        .maybeSingle();
      if (c?.status === 'normalized' && c.normalized_fields_id) { normalizedSuccess = true; break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (normalizedSuccess) {
      await pass(run, { step: 'normalize', name: 'cluster status=normalized via worker', hypothesis: 'H_LLM' });
    } else {
      await fail(run, { step: 'normalize', name: 'cluster status=normalized timeout', hypothesis: 'H_LLM' });
    }
  } else {
    // LLM 비활성 — 직접 upsert_lead_from_cluster 호출 (테스트 가속용)
    const { error } = await db().rpc('upsert_lead_from_cluster', { p_cluster_id: cluster.id as string });
    if (error) {
      await fail(run, { step: 'upsert_lead', name: 'upsert_lead_from_cluster RPC (skip-llm mode)', error: error.message });
    } else {
      await pass(run, { step: 'upsert_lead', name: 'upsert_lead_from_cluster RPC (skip-llm)' });
    }
  }

  // 4) Voice 응답 — 같은 entity_id 동봉
  const dealerResp = await postDealer({ axis: DEALER_FIXTURE_MINING, entityId, dealerId });
  if (dealerResp.status === 200 && dealerResp.responseId) {
    await pass(run, {
      step: 'voice', name: 'POST /responses-receive (dealer) 200',
      hypothesis: 'V_가설', durationMs: dealerResp.durationMs,
      actual: { id: dealerResp.responseId, segment: dealerResp.serverSegment },
    });
  } else {
    await fail(run, {
      step: 'voice', name: 'POST /responses-receive (dealer)',
      hypothesis: 'V_가설', actual: dealerResp,
    });
  }

  // 5) Lead 응집 확인 — sensor + voice 둘 다 카운트되었는지
  const { data: lead } = await db()
    .from('leads')
    .select('id, entity_id, crm_id, sensor_count, voice_count, score, priority, segment, score_at, score_version')
    .eq('entity_id', entityId).eq('crm_id', 'bitrix24')
    .maybeSingle();

  if (!lead) {
    await fail(run, { step: 'lead', name: 'leads row exists', hypothesis: 'H_채널통합', actual: null });
  } else {
    // H_채널통합 핵심 검증
    const okSensor = (lead.sensor_count as number) >= 1;
    const okVoice  = (lead.voice_count as number)  >= 1;
    if (okSensor && okVoice) {
      await pass(run, {
        step: 'unified', name: 'sensor_count ≥ 1 AND voice_count ≥ 1 (H_채널통합)',
        hypothesis: 'H_채널통합',
        actual: { sensor: lead.sensor_count, voice: lead.voice_count },
        metric: { name: 'channels', value: 2 },
      });
    } else {
      await fail(run, {
        step: 'unified', name: 'sensor_count ≥ 1 AND voice_count ≥ 1',
        hypothesis: 'H_채널통합',
        actual: { sensor: lead.sensor_count, voice: lead.voice_count },
      });
    }

    if (typeof lead.score === 'number' && lead.score > 0) {
      await pass(run, {
        step: 'score', name: 'leads.score > 0 (R_10.01 적용)',
        hypothesis: 'H_채널통합',
        actual: { score: lead.score, priority: lead.priority, version: lead.score_version },
        metric: { name: 'score', value: lead.score },
      });
    } else {
      await fail(run, { step: 'score', name: 'leads.score > 0', hypothesis: 'H_채널통합', actual: lead });
    }

    const expSeg = expectedSegment(DEALER_FIXTURE_MINING);
    if (lead.segment === expSeg) {
      await pass(run, { step: 'segment', name: `lead.segment === ${expSeg}`, hypothesis: 'V_가설', expected: expSeg, actual: lead.segment });
    } else {
      await fail(run, { step: 'segment', name: `lead.segment === ${expSeg}`, hypothesis: 'V_가설', expected: expSeg, actual: lead.segment });
    }

    // dealer_outputs active 1개
    const { data: out, error: outErr } = await db()
      .from('dealer_outputs')
      .select('id, segment, priority, score_snapshot, rule_version')
      .eq('lead_id', lead.id as string).eq('status', 'active');
    if (outErr) {
      await fail(run, { step: 'output', name: 'dealer_outputs query', error: outErr.message });
    } else if ((out ?? []).length === 1) {
      await pass(run, {
        step: 'output', name: 'dealer_outputs active row = 1', hypothesis: 'H_채널통합',
        actual: out?.[0],
      });
    } else {
      await fail(run, {
        step: 'output', name: 'dealer_outputs active row = 1', hypothesis: 'H_채널통합',
        actual: { count: (out ?? []).length, rows: out },
      });
    }

    // lead_links 확인 (cluster + response 모두)
    const { data: links } = await db()
      .from('lead_links')
      .select('source_table, source_id')
      .eq('lead_id', lead.id as string);
    const sources = new Set((links ?? []).map((l) => l.source_table));
    if (sources.has('entity_clusters') && sources.has('responses')) {
      await pass(run, {
        step: 'linkage', name: 'lead_links has both entity_clusters + responses',
        hypothesis: 'H_채널통합',
        actual: { count: links?.length, sources: Array.from(sources) },
      });
    } else {
      await fail(run, {
        step: 'linkage', name: 'lead_links has both entity_clusters + responses',
        hypothesis: 'H_채널통합',
        actual: { count: links?.length, sources: Array.from(sources) },
      });
    }
  }

  // 6) cleanup
  if (CONFIG.cleanup) {
    if (lead?.id) {
      await db().from('dealer_outputs').delete().eq('lead_id', lead.id as string);
      await db().from('lead_links').delete().eq('lead_id', lead.id as string);
    }
    if (dealerResp.responseId) {
      await db().from('response_answers').delete().eq('response_id', dealerResp.responseId);
      await db().from('responses').delete().eq('id', dealerResp.responseId);
    }
    if (dealerResp.jti) await db().from('voice_dealer_tokens').delete().eq('jti', dealerResp.jti);
    await teardown(key.keyId, fixtures);
    if (lead?.id) await db().from('leads').delete().eq('id', lead.id as string);
  }

  const result = await finishRun(run);
  process.exit(result.status === 'passed' ? 0 : 1);
}

async function teardown(keyId: string, fixtures: ReturnType<typeof makeSensorFixture>[]): Promise<void> {
  for (const fx of fixtures) {
    const { data: c } = await db().from('entity_clusters').select('id')
      .eq('entity_id', fx.entityId).eq('crm_id', fx.crmId).maybeSingle();
    await cleanupSensorFixture(fx, c?.id as string | undefined);
  }
  await revokeKey(keyId);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
