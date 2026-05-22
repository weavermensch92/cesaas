/**
 * GET /gridge-rule-get — R_10 룰 활성본 조회 (위버 편집 UI 용).
 *
 * serves: ['gridge_admin']  (실제로는 admin/super_admin 게이트, requireAdmin)
 * direction: 'downward'
 * harness: 2 (R_10 룰 운영)
 *
 * Query:
 *   (none)                     → 활성 룰 전체 요약 리스트
 *   ?rule_id=R_10.06_...       → 단일 룰의 body_yaml 전체 반환
 *
 * 응답 (list):
 *   {
 *     "rules": [
 *       { "rule_id": "R_10.06_PromptTemplates", "version": "2026-05-23.003",
 *         "last_modified": "...", "last_actor": "...", "body_bytes": 9080 },
 *       ...
 *     ]
 *   }
 *
 * 응답 (single):
 *   {
 *     "rule_id": "R_10.06_PromptTemplates",
 *     "version": "2026-05-23.003",
 *     "body_yaml": "rule_id: R_10.06_PromptTemplates\n...",
 *     "last_modified": "2026-05-23T...",
 *     "last_actor": "weaver@gridge.co.kr",
 *     "notes": "...",
 *     "row_id": "uuid"
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/gridge-rule-get';

interface RuleRow {
  id: string;
  rule_id: string;
  version: string;
  body_yaml: string;
  last_modified: string;
  modified_by: string | null;
  notes: string | null;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const ruleId = url.searchParams.get('rule_id');

    if (ruleId) return await getOne(ruleId, log);
    return await getList(log);
  } catch (err) {
    log.error('gridge-rule-get failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function getList(log: ReturnType<typeof requestLogger>): Promise<Response> {
  const { data, error } = await db()
    .from('rule_versions')
    .select('rule_id, version, body_yaml, last_modified, modified_by')
    .eq('status', 'active')
    .order('rule_id', { ascending: true })
    .returns<Pick<RuleRow, 'rule_id' | 'version' | 'body_yaml' | 'last_modified' | 'modified_by'>[]>();
  if (error) throw new ApiError('internal_error', 'rule list failed', { db: error.message });

  const rules = (data ?? []).map((r) => ({
    rule_id: r.rule_id,
    version: r.version,
    last_modified: r.last_modified,
    last_actor: r.modified_by ?? null,
    body_bytes: new TextEncoder().encode(r.body_yaml ?? '').length,
  }));

  log.info('gridge rule list', { count: rules.length });
  return jsonResponse(200, { rules }, log.requestId);
}

async function getOne(ruleId: string, log: ReturnType<typeof requestLogger>): Promise<Response> {
  if (!/^R_10\.\d+_\w+$/.test(ruleId)) {
    throw new ApiError('bad_request', `invalid rule_id: ${ruleId}`);
  }
  const { data, error } = await db()
    .from('rule_versions')
    .select('id, rule_id, version, body_yaml, last_modified, modified_by, notes')
    .eq('rule_id', ruleId)
    .eq('status', 'active')
    .maybeSingle<RuleRow>();
  if (error) throw new ApiError('internal_error', 'rule fetch failed', { db: error.message });
  if (!data) throw new ApiError('not_found', `no active row for ${ruleId}`);

  log.info('gridge rule get', { rule_id: ruleId, version: data.version });
  return jsonResponse(200, {
    rule_id: data.rule_id,
    version: data.version,
    body_yaml: data.body_yaml,
    last_modified: data.last_modified,
    last_actor: data.modified_by,
    notes: data.notes,
    row_id: data.id,
  }, log.requestId);
}
