/**
 * GET /admin-captures — Admin captures 목록 (cursor pagination).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['H1']
 *
 * Query:
 *   dealer_id     · crm_id
 *   screen_type   ('deal_detail,company' 콤마 구분)
 *   status        ('normalized,clustered' 콤마 구분)
 *   from, to      ISO 8601
 *   entity_id
 *   low_confidence=true  → entity_clusters.normalized_fields_id 의 평균 confidence < 0.7
 *   limit (1~200, 기본 50)
 *   cursor        base64(created_at + id)
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { buildPage, decodeCursor, parseLimit } from 'shared/pagination.ts';

interface CaptureListRow {
  id: string;
  created_at: string;
  captured_at: string;
  dealer_id: string;
  crm_id: string;
  url_path: string;
  screen_type: string | null;
  entity_id: string | null;
  status: string;
  image_path: string | null;
  classification_confidence: number | null;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/admin-captures' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const params = url.searchParams;
    const limit = parseLimit(params.get('limit'));
    const fetchLimit = limit + 1;

    let q = db()
      .from('captures')
      .select('id, created_at, captured_at, dealer_id, crm_id, url_path, screen_type, entity_id, status, image_path, classification_confidence');

    const dealerId = params.get('dealer_id');
    if (dealerId) q = q.eq('dealer_id', dealerId);

    const crmId = params.get('crm_id');
    if (crmId) q = q.eq('crm_id', crmId);

    const screenTypeRaw = params.get('screen_type');
    if (screenTypeRaw) q = q.in('screen_type', screenTypeRaw.split(',').map((s) => s.trim()));

    const statusRaw = params.get('status');
    if (statusRaw) q = q.in('status', statusRaw.split(',').map((s) => s.trim()));

    const entityId = params.get('entity_id');
    if (entityId) q = q.eq('entity_id', entityId);

    const from = params.get('from');
    if (from) q = q.gte('captured_at', from);
    const to = params.get('to');
    if (to) q = q.lte('captured_at', to);

    const cursor = params.get('cursor');
    if (cursor) {
      const { t, i } = decodeCursor(cursor);
      // (created_at, id) < (t, i)  — DESC 정렬에서의 "다음 페이지"
      q = q.or(`created_at.lt.${t},and(created_at.eq.${t},id.lt.${i})`);
    }

    q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(fetchLimit);

    const { data, error } = await q;
    if (error) throw new ApiError('internal_error', 'captures query failed', { db: error.message });

    const rows = (data ?? []) as CaptureListRow[];
    const withSigned = await attachSignedUrls(rows);
    const page = buildPage(withSigned, limit);

    return jsonResponse(200, page, log.requestId);
  } catch (err) {
    log.error('admin-captures failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function attachSignedUrls<T extends { id: string; image_path: string | null }>(
  rows: T[],
): Promise<Array<T & { thumbnail_url: string | null }>> {
  const out: Array<T & { thumbnail_url: string | null }> = [];
  for (const r of rows) {
    if (!r.image_path) {
      out.push({ ...r, thumbnail_url: null });
      continue;
    }
    const { data } = await db().storage.from('captures').createSignedUrl(r.image_path, 60 * 30);
    out.push({ ...r, thumbnail_url: data?.signedUrl ?? null });
  }
  return out;
}
