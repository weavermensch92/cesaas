/**
 * GET /admin-leads-detail?id=... — Lead 상세 + linkage + recent captures/responses + active DealerOutput.
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['H_채널통합']
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/admin-leads-detail' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw new ApiError('bad_request', 'id required');

    const supa = db();

    const { data: lead, error: lErr } = await supa
      .from('leads').select('*').eq('id', id).maybeSingle();
    if (lErr) throw new ApiError('internal_error', 'lead query failed', { db: lErr.message });
    if (!lead) throw new ApiError('not_found', 'lead not found', { id });

    // 연결된 clusters
    const { data: clusters } = await supa
      .from('entity_clusters')
      .select('id, entity_id, crm_id, image_count, status, normalized_fields_id, normalized_at, updated_at')
      .eq('lead_id', id)
      .order('updated_at', { ascending: false })
      .limit(20);

    // 연결된 responses
    const { data: responses } = await supa
      .from('responses')
      .select('id, respondent_type, dealer_id, device_id, segment, nps, language, contact_opted_in, captured_at')
      .eq('lead_id', id)
      .order('captured_at', { ascending: false })
      .limit(50);

    // 활성 normalized_fields (가장 최근)
    let normalized: unknown = null;
    if (clusters && clusters.length > 0 && clusters[0]?.normalized_fields_id) {
      const { data: nf } = await supa
        .from('normalized_fields')
        .select('*')
        .eq('id', clusters[0].normalized_fields_id as string)
        .maybeSingle();
      normalized = nf;
    }

    // 활성 DealerOutput
    const { data: output } = await supa
      .from('dealer_outputs')
      .select('*')
      .eq('lead_id', id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .maybeSingle();

    // linkage 이력
    const { data: links } = await supa
      .from('lead_links')
      .select('id, source_table, source_id, linked_at')
      .eq('lead_id', id)
      .order('linked_at', { ascending: false })
      .limit(50);

    return jsonResponse(200, {
      lead,
      clusters: clusters ?? [],
      responses: responses ?? [],
      normalized,
      dealer_output: output,
      links: links ?? [],
    }, log.requestId);
  } catch (err) {
    log.error('admin-leads-detail failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
