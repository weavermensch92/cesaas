/**
 * POST /normalize-worker — 정규화 큐 처리.
 *
 * serves: ['system']
 * direction: 'downward'
 * related_hypothesis: ['H3', 'H_LLM']
 * harness: 1
 *
 * 호출 주체: pg_cron + pg_net (1분마다). 인증: Supabase service_role JWT (verify_jwt=false인 함수지만
 * pg_cron이 service_role bearer 동봉).
 *
 * 흐름:
 *   1. lock_pending_queue(batch_size=N) — 우선순위·scheduled_at 정렬 + SKIP LOCKED
 *   2. 각 항목:
 *      a. buildClusterImages — 5장 다양화 + base64
 *      b. callRule('R_10.06_PromptTemplates', 'sensor_13_fields')
 *      c. parseLlmFields → fields + confidences
 *      d. save_normalized_with_supersede RPC — INSERT + supersede + cluster.status='normalized'
 *      e. 큐 항목 status='done'
 *   3. 실패 시 requeue_queue_item(p_max_tries=3)
 *
 * 50s 한도 우회 — 한 호출에서 batch_size 작게 (5) + 각 LLM 호출 평균 10~25s.
 */

import { jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { callRule } from 'shared/llm.ts';
import { buildClusterImages, parseLlmFields } from 'shared/normalize.ts';

const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;

interface QueueItem {
  id: string;
  cluster_id: string;
  priority: string;
  attempts: number;
}

interface WorkerInput {
  batch_size?: number;
}

interface ItemResult {
  queue_id: string;
  cluster_id: string;
  status: 'done' | 'requeued' | 'failed';
  reason?: string;
  prompt_version?: string | null;
  rule_version?: string;
}

Deno.serve(async (req: Request) => {
  const log = requestLogger(req, { route: '/normalize-worker' });
  try {
    if (req.method !== 'POST') {
      return jsonResponse(405, { error: 'bad_request', message: 'POST only' }, log.requestId);
    }

    const input = await parseInput(req);
    const batchSize = Math.min(input.batch_size ?? DEFAULT_BATCH, MAX_BATCH);

    const { data, error } = await db().rpc('lock_pending_queue', { p_limit: batchSize });
    if (error) {
      log.error('lock_pending_queue failed', error);
      return jsonResponse(500, {
        error: 'internal_error', message: 'queue lock failed', details: { db: error.message },
      }, log.requestId);
    }

    const items = (data ?? []) as QueueItem[];
    if (items.length === 0) {
      return jsonResponse(200, { processed: 0, results: [] }, log.requestId);
    }
    log.info('queue locked', { count: items.length });

    const results: ItemResult[] = [];
    for (const item of items) {
      const r = await processOne(item, log);
      results.push(r);
    }

    return jsonResponse(200, { processed: results.length, results }, log.requestId);
  } catch (err) {
    log.error('worker failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseInput(req: Request): Promise<WorkerInput> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as WorkerInput;
  } catch {
    return {};
  }
}

async function processOne(
  item: QueueItem,
  log: ReturnType<typeof requestLogger>,
): Promise<ItemResult> {
  const itemLog = (msg: string, fields?: Record<string, unknown>) =>
    log.info(msg, { queue_id: item.id, cluster_id: item.cluster_id, ...fields });

  try {
    itemLog('processing');

    // 1) 클러스터 → 이미지 5장
    const built = await buildClusterImages(item.cluster_id);
    itemLog('cluster built', {
      images: built.images.length,
      captures: built.selectedCaptureIds,
    });

    // 2) LLM 호출
    const result = await callRule('R_10.06_PromptTemplates', 'sensor_13_fields', {
      images: built.images,
      context: { queue_id: item.id, cluster_id: item.cluster_id, entity_id: built.entityId },
    });

    // 3) 응답 파싱
    const { fields, confidences } = parseLlmFields(result.text);
    itemLog('llm parsed', {
      model: result.model,
      rule_version: result.ruleVersion,
      prompt_version: result.promptVersion,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
    });

    // 4) RPC — 13 필드 INSERT + supersede + cluster status=normalized
    const { data: newId, error: rpcErr } = await db().rpc('save_normalized_with_supersede', {
      p_cluster_id: item.cluster_id,
      p_fields: fields,
      p_confidences: confidences,
      p_model: result.model,
      p_prompt_version: result.promptVersion ?? result.ruleVersion,
    });
    if (rpcErr) throw new Error(`save RPC failed: ${rpcErr.message}`);

    // 5) 큐 done
    await db()
      .from('normalize_queue')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', item.id);

    itemLog('done', { normalized_fields_id: newId });
    return {
      queue_id: item.id,
      cluster_id: item.cluster_id,
      status: 'done',
      prompt_version: result.promptVersion,
      rule_version: result.ruleVersion,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('item failed', err, { queue_id: item.id, cluster_id: item.cluster_id });
    const { data: nextStatus, error: requeueErr } = await db().rpc('requeue_queue_item', {
      p_id: item.id,
      p_error: reason,
    });
    if (requeueErr) {
      log.error('requeue failed', requeueErr, { queue_id: item.id });
      return {
        queue_id: item.id,
        cluster_id: item.cluster_id,
        status: 'failed',
        reason: `${reason} (requeue error: ${requeueErr.message})`,
      };
    }
    return {
      queue_id: item.id,
      cluster_id: item.cluster_id,
      status: nextStatus === 'failed' ? 'failed' : 'requeued',
      reason,
    };
  }
}
