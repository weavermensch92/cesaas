/**
 * POST /admin-normalize-trigger — Admin이 클러스터 재정규화 요청.
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['H3']
 *
 * Body:
 *   { "cluster_id": "uuid", "priority": "high|normal|low", "reason": "..." }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

interface TriggerBody {
  cluster_id: string;
  priority?: 'high' | 'normal' | 'low';
  reason?: string;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/admin-normalize-trigger' });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);

    const body = await parseBody(req);

    const { data, error } = await db().rpc('enqueue_normalize_priority', {
      p_cluster_id: body.cluster_id,
      p_priority: body.priority ?? 'high',
      p_actor: admin.email,
      p_reason: body.reason ?? null,
    });
    if (error) {
      if (error.code === '22023') {
        throw new ApiError('validation_failed', error.message);
      }
      throw new ApiError('internal_error', 'enqueue RPC failed', { db: error.message });
    }

    log.info('renormalize enqueued', {
      cluster_id: body.cluster_id, queue_id: data, actor: admin.email,
    });
    return jsonResponse(202, {
      queue_id: data,
      cluster_id: body.cluster_id,
      enqueued_at: new Date().toISOString(),
    }, log.requestId);
  } catch (err) {
    log.error('admin-normalize-trigger failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseBody(req: Request): Promise<TriggerBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch {
    throw new ApiError('bad_request', 'body must be JSON');
  }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;
  const clusterId = String(o.cluster_id ?? '');
  if (!clusterId) throw new ApiError('validation_failed', 'cluster_id required');
  const priority = o.priority as TriggerBody['priority'] | undefined;
  return {
    cluster_id: clusterId,
    ...(priority ? { priority } : {}),
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
  };
}
