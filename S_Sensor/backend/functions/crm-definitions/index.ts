/**
 * GET /v1/crm-definitions — Sensor Extension용 동적 CRM 매트릭스.
 *
 * serves: ['dealer']
 * direction: 'downward'
 * related_hypothesis: ['H1']
 * harness: 1
 *
 * HMAC 검증 후 status IN ('active','beta') CRM 정의를 번들 JSON과 동일 shape로 반환.
 * Extension은 chrome.storage.local에 캐시하고 alarm 주기마다 갱신.
 *
 * 응답:
 *   {
 *     defs: { "<crm_id>": { id, name, host_pattern, capture_paths, screen_patterns } },
 *     version: "<versionSum>-<maxUpdatedAt>",
 *     fetched_at: "<iso>"
 *   }
 */

import { verifyHmac } from 'shared/hmac.ts';
import { ApiError, corsPreflight, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/v1/crm-definitions';

interface CrmRow {
  id: string;
  name: string;
  host_pattern: string;
  capture_paths: string[] | null;
  screen_patterns: unknown;
  version: number | null;
  updated_at: string;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req);
  if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') {
      throw new ApiError('bad_request', 'method not allowed', { method: req.method });
    }

    // GET — body 빈 바이트로 HMAC 검증.
    const identity = await verifyHmac(req, new Uint8Array(0));

    const { data, error } = await db()
      .from('crm_definitions')
      .select('id, name, host_pattern, capture_paths, screen_patterns, version, updated_at')
      .in('status', ['active', 'beta'])
      .order('id', { ascending: true });
    if (error) {
      throw new ApiError('internal_error', 'crm_definitions load failed', { db: error.message });
    }

    const rows = (data ?? []) as CrmRow[];
    const defs: Record<string, unknown> = {};
    let maxUpdatedAt = '';
    let versionSum = 0;
    for (const r of rows) {
      defs[r.id] = {
        id: r.id,
        name: r.name,
        host_pattern: r.host_pattern,
        capture_paths: r.capture_paths && r.capture_paths.length ? r.capture_paths : ['/'],
        screen_patterns: r.screen_patterns ?? [],
      };
      if (r.updated_at > maxUpdatedAt) maxUpdatedAt = r.updated_at;
      versionSum += r.version ?? 0;
    }

    const body = {
      defs,
      version: `${versionSum}-${maxUpdatedAt}`,
      fetched_at: new Date().toISOString(),
    };

    log.info('crm-definitions served', { key_id: identity.keyId, count: rows.length });
    return jsonResponse(200, body, log.requestId);
  } catch (err) {
    log.error('crm-definitions failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
