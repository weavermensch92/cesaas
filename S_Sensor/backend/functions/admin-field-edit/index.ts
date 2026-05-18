/**
 * PATCH /admin-field-edit — 단일 13 필드 수동 편집.
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['H3']
 *
 * Body:
 *   {
 *     "normalized_id": "uuid-...",
 *     "field_name":    "stage",
 *     "new_value":     "negotiation",   // null 가능 (필드 비움)
 *     "reason":        "..."
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

interface EditBody {
  normalized_id: string;
  field_name: string;
  new_value: string | null;
  reason?: string;
}

Deno.serve(async (req: Request) => {
  const log = requestLogger(req, { route: '/admin-field-edit' });
  try {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
      throw new ApiError('bad_request', 'PATCH (or POST) only');
    }
    const admin = await requireAdmin(req);

    const body = await parseBody(req);

    const { data, error } = await db().rpc('edit_normalized_field', {
      p_normalized_id: body.normalized_id,
      p_field_name: body.field_name,
      p_new_value: body.new_value,
      p_edited_by: admin.email,
      p_reason: body.reason ?? null,
    });
    if (error) {
      if (error.code === '22023') {
        throw new ApiError('validation_failed', error.message, { field: body.field_name });
      }
      if (error.code === 'P0002') {
        throw new ApiError('not_found', error.message, { normalized_id: body.normalized_id });
      }
      throw new ApiError('internal_error', 'edit RPC failed', { db: error.message });
    }
    log.info('field edited', {
      normalized_id: body.normalized_id,
      field: body.field_name,
      actor: admin.email,
    });
    return jsonResponse(200, { edit_id: data, status: 'ok' }, log.requestId);
  } catch (err) {
    log.error('admin-field-edit failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseBody(req: Request): Promise<EditBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch {
    throw new ApiError('bad_request', 'body must be JSON');
  }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;
  const normalizedId = String(o.normalized_id ?? '');
  const fieldName = String(o.field_name ?? '');
  if (!normalizedId || !fieldName) {
    throw new ApiError('validation_failed', 'normalized_id and field_name required');
  }
  return {
    normalized_id: normalizedId,
    field_name: fieldName,
    new_value: o.new_value === undefined ? null : (o.new_value as string | null),
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
  };
}
