/**
 * GET /admin-clusters?id=... — 클러스터 상세 + 13 필드 + 5장 signed URL + 편집 이력.
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['H3']
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const FIELD_KEYS = [
  'deal_id', 'deal_code', 'company_name',
  'contact_name', 'contact_phone', 'contact_email',
  'amount', 'currency', 'stage', 'product_model',
  'region', 'date_created', 'responsible_dealer',
] as const;

const CONFIDENCE_KEYS = FIELD_KEYS.filter((k) => k !== 'currency');

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/admin-clusters' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const clusterId = url.searchParams.get('id');
    const entityId = url.searchParams.get('entity_id');
    const crmId = url.searchParams.get('crm_id');
    if (!clusterId && !(entityId && crmId)) {
      throw new ApiError('bad_request', 'id (uuid) 또는 entity_id+crm_id 필요');
    }

    const supa = db();
    let cq = supa
      .from('entity_clusters')
      .select('id, entity_id, crm_id, capture_ids, image_count, status, normalized_fields_id, normalized_at, region, version, created_at, updated_at');
    if (clusterId) cq = cq.eq('id', clusterId);
    else cq = cq.eq('entity_id', entityId!).eq('crm_id', crmId!);
    const { data: cluster, error: cErr } = await cq.maybeSingle();
    if (cErr) throw new ApiError('internal_error', 'cluster query failed', { db: cErr.message });
    if (!cluster) {
      throw new ApiError('not_found', 'cluster not found', {
        id: clusterId, entity_id: entityId, crm_id: crmId,
      });
    }

    const captureIds = (cluster.capture_ids as string[]) ?? [];
    const { data: capRows, error: capErr } = await supa
      .from('captures')
      .select('id, dealer_id, screen_type, classification_confidence, captured_at, image_path, status')
      .in('id', captureIds);
    if (capErr) throw new ApiError('internal_error', 'captures query failed', { db: capErr.message });

    const captures = await attachSignedUrls(capRows ?? []);
    captures.sort((a, b) => a.captured_at.localeCompare(b.captured_at));

    let normalized: Record<string, unknown> | null = null;
    let edits: unknown[] = [];
    if (cluster.normalized_fields_id) {
      const { data: nf, error: nErr } = await supa
        .from('normalized_fields')
        .select('*')
        .eq('id', cluster.normalized_fields_id as string)
        .maybeSingle();
      if (nErr) throw new ApiError('internal_error', 'normalized query failed', { db: nErr.message });
      if (nf) {
        normalized = toFieldsView(nf as Record<string, unknown>);

        const { data: ed } = await supa
          .from('normalized_field_edits')
          .select('id, field_name, llm_value, llm_confidence, edited_value, edited_by, reason, created_at, prompt_version')
          .eq('normalized_fields_id', cluster.normalized_fields_id as string)
          .order('created_at', { ascending: false });
        edits = ed ?? [];
      }
    }

    // 큐 상태
    const { data: queueRows } = await supa
      .from('normalize_queue')
      .select('id, status, priority, attempts, last_error, scheduled_at, started_at, completed_at, enqueued_at')
      .eq('cluster_id', clusterId)
      .order('enqueued_at', { ascending: false })
      .limit(5);

    return jsonResponse(200, {
      cluster,
      captures,
      normalized,
      edits,
      queue: queueRows ?? [],
    }, log.requestId);
  } catch (err) {
    log.error('admin-clusters failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

interface CaptureRow {
  id: string;
  dealer_id: string;
  screen_type: string | null;
  classification_confidence: number | null;
  captured_at: string;
  image_path: string | null;
  status: string;
}

async function attachSignedUrls(rows: CaptureRow[]): Promise<Array<CaptureRow & { image_url: string | null }>> {
  const out: Array<CaptureRow & { image_url: string | null }> = [];
  for (const r of rows) {
    if (!r.image_path) { out.push({ ...r, image_url: null }); continue; }
    const { data } = await db().storage.from('captures').createSignedUrl(r.image_path, 60 * 30);
    out.push({ ...r, image_url: data?.signedUrl ?? null });
  }
  return out;
}

function toFieldsView(row: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, { value: unknown; confidence: number | null }> = {};
  for (const k of FIELD_KEYS) {
    const value = row[k] ?? null;
    const confKey = `${k}_confidence`;
    const conf = CONFIDENCE_KEYS.includes(k as never)
      ? (row[confKey] as number | null) ?? null
      : null;
    fields[k] = { value, confidence: conf };
  }
  return {
    id: row.id,
    cluster_id: row.cluster_id,
    entity_id: row.entity_id,
    crm_id: row.crm_id,
    status: row.status,
    model: row.model,
    prompt_version: row.prompt_version,
    created_at: row.created_at,
    edited_by: row.edited_by,
    edited_at: row.edited_at,
    fields,
  };
}
