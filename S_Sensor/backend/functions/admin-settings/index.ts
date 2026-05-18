/**
 * GET   /admin-settings   → { anthropic_api_key: { present, last_4, updated_at } }
 * PATCH /admin-settings   → body { anthropic_api_key: "sk-ant-..." } → 회전
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * 키 평문은 GET 응답에 절대 포함하지 않음 (last_4 만).
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

interface KeyMeta {
  present: boolean;
  last_4: string | null;
  updated_at: string | null;
}

Deno.serve(async (req: Request) => {
  const log = requestLogger(req, { route: '/admin-settings' });
  try {
    const admin = await requireAdmin(req);

    if (req.method === 'GET') {
      const meta = await loadKeyMeta();
      return jsonResponse(200, { anthropic_api_key: meta }, log.requestId);
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      const raw = await safeJson(req);
      const key = typeof raw?.anthropic_api_key === 'string' ? raw.anthropic_api_key.trim() : '';
      if (!key) throw new ApiError('validation_failed', 'anthropic_api_key required (string)');
      if (key.length < 20) throw new ApiError('validation_failed', 'key too short');
      const { error } = await db().rpc('set_anthropic_api_key', { p_key: key });
      if (error) throw new ApiError('internal_error', 'vault write failed', { db: error.message });
      log.info('anthropic api key rotated', { actor: admin.email });
      const meta = await loadKeyMeta();
      return jsonResponse(200, { anthropic_api_key: meta, status: 'rotated' }, log.requestId);
    }
    throw new ApiError('bad_request', 'GET or PATCH only');
  } catch (err) {
    log.error('admin-settings failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function loadKeyMeta(): Promise<KeyMeta> {
  const { data, error } = await db().rpc('get_anthropic_api_key_meta');
  if (error) throw new ApiError('internal_error', 'vault read failed', { db: error.message });
  const row = Array.isArray(data) ? data[0] : data;
  return {
    present: Boolean(row?.present),
    last_4: row?.last_4 ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return await req.json() as Record<string, unknown>; } catch { return null; }
}
