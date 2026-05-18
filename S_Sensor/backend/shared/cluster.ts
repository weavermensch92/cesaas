// EntityCluster UPSERT — S_20.03.
// entity_id가 있으면 묶고, 임계(3장) 또는 idle(5분) 도달 시 정규화 큐 트리거.

import { db } from './db.ts';
import { ApiError } from './errors.ts';
import { log } from './logger.ts';

const TRIGGER_THRESHOLD = 3;
const MAX_PER_CLUSTER = 10;
const IDLE_TRIGGER_MS = 5 * 60 * 1000;

export interface UpsertArgs {
  entityId: string;
  crmId: string;
  captureId: string;
  region?: string;
}

export interface UpsertResult {
  clusterId: string;
  imageCount: number;
  triggered: boolean;
}

/**
 * 같은 (entity_id, crm_id) 클러스터에 capture 추가.
 * UNIQUE (entity_id, crm_id) — DB 제약 활용.
 */
export async function upsertCluster(args: UpsertArgs): Promise<UpsertResult> {
  const supa = db();
  // 1) 기존 조회
  const { data: existing, error: selErr } = await supa
    .from('entity_clusters')
    .select('id, capture_ids, image_count, status, updated_at')
    .eq('entity_id', args.entityId)
    .eq('crm_id', args.crmId)
    .maybeSingle();
  if (selErr) throw new ApiError('internal_error', 'cluster lookup failed', { db: selErr.message });

  let clusterId: string;
  let imageCount: number;
  let updatedAt: string;

  if (!existing) {
    const { data: inserted, error: insErr } = await supa
      .from('entity_clusters')
      .insert({
        entity_id: args.entityId,
        crm_id: args.crmId,
        capture_ids: [args.captureId],
        image_count: 1,
        region: args.region ?? 'ru',
        status: 'pending_normalize',
      })
      .select('id, image_count, updated_at')
      .single();
    if (insErr) {
      // 동시 INSERT 경쟁 — UNIQUE 위반 시 재시도 1회.
      if (insErr.code === '23505') return upsertCluster(args);
      throw new ApiError('internal_error', 'cluster insert failed', { db: insErr.message });
    }
    clusterId = inserted.id as string;
    imageCount = inserted.image_count as number;
    updatedAt = inserted.updated_at as string;
  } else {
    if ((existing.capture_ids as string[]).includes(args.captureId)) {
      return {
        clusterId: existing.id as string,
        imageCount: existing.image_count as number,
        triggered: false,
      };
    }
    if ((existing.image_count as number) >= MAX_PER_CLUSTER) {
      log('warn', 'cluster at max — skipping append', {
        cluster_id: existing.id, entity_id: args.entityId,
      });
      return {
        clusterId: existing.id as string,
        imageCount: existing.image_count as number,
        triggered: false,
      };
    }
    const nextIds = [...(existing.capture_ids as string[]), args.captureId];
    const { data: updated, error: updErr } = await supa
      .from('entity_clusters')
      .update({
        capture_ids: nextIds,
        image_count: nextIds.length,
      })
      .eq('id', existing.id as string)
      .select('id, image_count, updated_at')
      .single();
    if (updErr) throw new ApiError('internal_error', 'cluster update failed', { db: updErr.message });
    clusterId = updated.id as string;
    imageCount = updated.image_count as number;
    updatedAt = updated.updated_at as string;
  }

  // 정규화 큐 트리거 — 임계 3장 또는 5분 이상 idle.
  const idleMs = Date.now() - new Date(updatedAt).getTime();
  const shouldTrigger = imageCount >= TRIGGER_THRESHOLD || idleMs >= IDLE_TRIGGER_MS;

  // captures.status='clustered'로 갱신은 finalize 핸들러가 별도로 수행.
  // 큐 트리거는 entity_clusters.status가 이미 'pending_normalize' — pg_cron이 픽업.

  return { clusterId, imageCount, triggered: shouldTrigger };
}
