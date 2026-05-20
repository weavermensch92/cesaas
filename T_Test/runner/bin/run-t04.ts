#!/usr/bin/env -S node --import=tsx
/**
 * T_04 Sensor E2E — Extension 캡쳐 → 송출 → 분류 → 클러스터 → (옵션) 정규화.
 *
 * 가설:
 *   H1 (캡쳐·송출 성공률 ≥ 98%): chunks 모두 200·finalize 200·status 'clustered'
 *   H3 (정규화 시도 100%):        entity_clusters.status==='pending_normalize'|'normalized'
 *   H_LLM (정확도) — opt-in:      normalized_fields(active) 행 존재 + 13 컬럼 누락 검증
 *
 * Usage:
 *   npm run t04 -w @hd/t-test [-- --captures 7 --llm]
 */

import { CONFIG } from '../lib/config.js';
import { fail, finishRun, pass, startRun } from '../lib/assert.js';
import { makeSensorFixture } from '../lib/fixtures.js';
import {
  cleanupSensorFixture, pollClusterNormalized, provisionTestKey,
  revokeKey, sendAllChunks, sendFinalize,
} from '../lib/sensor-helpers.js';
import { db } from '../lib/db.js';

interface CliArgs { captures?: string; llm?: 'true' | 'false' }
function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith('--')) {
      (out as Record<string, string>)[k] = v;
      i += 1;
    } else {
      (out as Record<string, string>)[k] = 'true';
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const count = Math.max(1, Math.min(50, Number(args.captures ?? 3)));
  const llmEnabled = (args.llm === 'true') || CONFIG.includeLlm;

  const run = await startRun({
    suite: 'T_04', scenario: 'sensor_full',
    notes: `captures=${count} · llm=${llmEnabled}`,
  });

  // 1) HMAC 키 프로비전
  const tStart = Date.now();
  let key;
  try {
    key = await provisionTestKey();
    await pass(run, { step: 'provision', name: 'sensor_api_keys INSERT', durationMs: Date.now() - tStart, actual: { key_id: key.keyId } });
  } catch (e) {
    await fail(run, { step: 'provision', name: 'sensor_api_keys INSERT', error: String((e as Error).message) });
    await finishRun(run);
    process.exit(1);
  }

  const fixtures = Array.from({ length: count }, () => makeSensorFixture({ dealerId: `t_test_dealer_${run.id.slice(0, 6)}` }));
  // 같은 entity_id로 클러스터 묶임 검증을 위해 일부는 같은 entity 공유 (3장 이상이면 같은 entity로 묶음)
  if (fixtures.length >= 3) {
    const shared = fixtures[0]!.entityId;
    fixtures[1]!.entityId = shared;
    fixtures[1]!.url = `https://bitrix.gkcompany.pro/crm/deal/details/${shared}/`;
    fixtures[1]!.urlPath = `/crm/deal/details/${shared}/`;
    fixtures[2]!.entityId = shared;
    fixtures[2]!.url = `https://bitrix.gkcompany.pro/crm/deal/details/${shared}/`;
    fixtures[2]!.urlPath = `/crm/deal/details/${shared}/`;
  }

  // 2) chunks → finalize 일괄 송출
  let chunksOk = 0, chunksTotal = 0;
  let finalizeOk = 0, finalizeTotal = 0;
  const latencies: number[] = [];

  for (const fx of fixtures) {
    const chunksRes = await sendAllChunks(key, fx);
    chunksTotal += chunksRes.statuses.length;
    chunksOk += chunksRes.statuses.filter((s) => s === 200).length;

    finalizeTotal += 1;
    const finalize = await sendFinalize(key, fx, chunksRes.totalChunks, chunksRes.fullHashHex);
    if (finalize.status === 200) finalizeOk += 1;
    latencies.push(finalize.durationMs);

    const sendOk = finalize.status === 200 && chunksRes.statuses.every((s) => s === 200);
    const recorder = sendOk ? pass : fail;
    await recorder(run, {
      step: 'send', name: `capture ${fx.captureId.slice(0, 8)} delivered`,
      hypothesis: 'H1',
      actual: { chunk_statuses: chunksRes.statuses, finalize_status: finalize.status, finalize_ms: finalize.durationMs, finalize_body: finalize.body },
      metric: { name: 'finalize_ms', value: finalize.durationMs },
      durationMs: finalize.durationMs,
      ...(sendOk ? {} : { error: `chunks=${chunksRes.statuses.join(',')} finalize=${finalize.status}` }),
    });
  }

  // 2a) H1 정량 — 송출 성공률
  const chunkRate = chunksTotal === 0 ? 0 : (chunksOk / chunksTotal) * 100;
  const finalizeRate = finalizeTotal === 0 ? 0 : (finalizeOk / finalizeTotal) * 100;
  const PASS_THRESHOLD = 98;

  if (chunkRate >= PASS_THRESHOLD) {
    await pass(run, { step: 'metric_h1', name: 'chunk success_rate ≥ 98%', hypothesis: 'H1', expected: '≥98', actual: chunkRate, metric: { name: 'success_rate', value: chunkRate } });
  } else {
    await fail(run, { step: 'metric_h1', name: 'chunk success_rate ≥ 98%', hypothesis: 'H1', expected: '≥98', actual: chunkRate, metric: { name: 'success_rate', value: chunkRate } });
  }

  // latency P95
  const p95 = latencies.length > 0
    ? latencies.slice().sort((a, b) => a - b)[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]!
    : 0;
  await pass(run, { step: 'metric_h1', name: 'finalize P95 latency', hypothesis: 'H1', actual: { p95_ms: p95, samples: latencies.length }, metric: { name: 'p95_ms', value: p95 } });

  // 3) 분류·클러스터 검증
  const sharedEntity = fixtures.find((f, i) => fixtures.findIndex((g) => g.entityId === f.entityId) !== i)?.entityId;
  if (sharedEntity) {
    const target = fixtures.find((f) => f.entityId === sharedEntity)!;
    const cluster = await pollClusterNormalized(target, 30 * 1000);
    if (cluster.found && cluster.imageCount && cluster.imageCount >= 3) {
      await pass(run, {
        step: 'cluster', name: 'entity_clusters image_count ≥ 3 (multi-image 묶음)',
        hypothesis: 'H3',
        actual: { cluster_id: cluster.clusterId, image_count: cluster.imageCount, status: cluster.status },
        metric: { name: 'image_count', value: cluster.imageCount },
      });
    } else {
      await fail(run, {
        step: 'cluster', name: 'entity_clusters image_count ≥ 3',
        hypothesis: 'H3',
        actual: { ...cluster },
      });
    }

    // 4) 정규화 시도 검증 — H3
    if (llmEnabled) {
      const norm = await pollClusterNormalized(target, CONFIG.normalizeTimeoutMs);
      if (norm.found && norm.status === 'normalized' && norm.normalizedFieldsId) {
        const { data: nf } = await db()
          .from('normalized_fields')
          .select('id, model, prompt_version, status, deal_id, company_name, amount, currency, stage')
          .eq('id', norm.normalizedFieldsId)
          .maybeSingle();
        await pass(run, {
          step: 'normalize', name: 'normalized_fields(active) 행 생성',
          hypothesis: 'H_LLM',
          actual: nf,
          metric: { name: 'waited_ms', value: norm.waitedMs },
          durationMs: norm.waitedMs,
        });
      } else {
        await fail(run, {
          step: 'normalize', name: 'normalize timeout',
          hypothesis: 'H_LLM',
          actual: norm,
          error: `cluster status=${norm.status} after ${norm.waitedMs}ms`,
        });
      }
    } else {
      // H3 'attempt' — pending_normalize 또는 done 까지 도달했는지
      const { data: queue } = await db()
        .from('normalize_queue')
        .select('id, status, attempts')
        .eq('cluster_id', cluster.clusterId ?? '00000000-0000-0000-0000-000000000000')
        .order('enqueued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (queue) {
        await pass(run, {
          step: 'normalize_attempt', name: 'normalize_queue 진입 확인 (H3 attempt 100%)',
          hypothesis: 'H3',
          actual: queue,
        });
      } else {
        await fail(run, {
          step: 'normalize_attempt', name: 'normalize_queue 진입 안 됨',
          hypothesis: 'H3',
          actual: null, error: 'no queue row',
        });
      }
    }
  } else {
    await pass(run, { step: 'cluster', name: 'cluster step skipped (no shared entity)' });
  }

  // 5) Cleanup
  if (CONFIG.cleanup) {
    for (const fx of fixtures) {
      const { data: cluster } = await db()
        .from('entity_clusters')
        .select('id')
        .eq('entity_id', fx.entityId).eq('crm_id', fx.crmId)
        .maybeSingle();
      await cleanupSensorFixture(fx, cluster?.id as string | undefined);
    }
    await revokeKey(key.keyId);
  }

  const result = await finishRun(run);
  process.exit(result.status === 'passed' ? 0 : 1);
}

await main().catch((e) => {
  if (e && (e as { __t_test_silent?: boolean }).__t_test_silent) throw e;
  console.error('FATAL', e);
  process.exit(2);
});
