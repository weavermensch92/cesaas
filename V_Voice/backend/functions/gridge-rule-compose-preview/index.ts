/**
 * GET /gridge-rule-compose-preview — parent body_yaml + active fragments + (옵션) draft inject → 평면 YAML.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * harness: 2
 *
 * Query:
 *   ?rule_id=R_10.06_PromptTemplates
 *   &draft_fragment_id=uuid              // 선택 — 합성에 포함시킬 draft 1개
 *
 * 응답:
 *   {
 *     "rule_id": "R_10.06_PromptTemplates",
 *     "parent_version": "2026-05-23.004",
 *     "parent_yaml":   "(원본 active body_yaml)",
 *     "composed_yaml": "(fragments inject된 평면 YAML)",
 *     "fragments_used": [{ id, fragment_path, status }],
 *     "draft_included": boolean
 *   }
 *
 * 실패:
 *   400 bad_request    — rule_id 누락
 *   404 not_found      — parent active row 없음
 *   500 internal_error — compose 실패 (YAML parse 등)
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { composeYaml, type Fragment } from 'shared/rule_compose.ts';

const ROUTE = '/gridge-rule-compose-preview';

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const ruleId = url.searchParams.get('rule_id');
    const draftId = url.searchParams.get('draft_fragment_id');

    if (!ruleId) throw new ApiError('bad_request', 'rule_id required');
    if (!/^R_10\.\d+_\w+$/.test(ruleId)) {
      throw new ApiError('bad_request', `invalid rule_id: ${ruleId}`);
    }

    // 1) parent active row
    const { data: parent, error: parentErr } = await db()
      .from('rule_versions')
      .select('version, body_yaml')
      .eq('rule_id', ruleId)
      .eq('status', 'active')
      .maybeSingle<{ version: string; body_yaml: string }>();
    if (parentErr) throw new ApiError('internal_error', 'parent fetch failed', { db: parentErr.message });
    if (!parent) throw new ApiError('not_found', `no active row for ${ruleId}`);

    // 2) active fragments + (옵션) draft 1개
    const { data: activeFrags, error: fragErr } = await db()
      .from('rule_fragments')
      .select('id, fragment_path, generated_yaml, imports, status')
      .eq('rule_id', ruleId)
      .eq('status', 'active')
      .returns<FragmentRow[]>();
    if (fragErr) throw new ApiError('internal_error', 'fragments fetch failed', { db: fragErr.message });

    let draftFrag: FragmentRow | null = null;
    if (draftId) {
      const { data, error } = await db()
        .from('rule_fragments')
        .select('id, fragment_path, generated_yaml, imports, status')
        .eq('id', draftId)
        .eq('rule_id', ruleId)
        .maybeSingle<FragmentRow>();
      if (error) throw new ApiError('internal_error', 'draft fetch failed', { db: error.message });
      if (data) draftFrag = data;
    }

    // 3) draft 가 같은 fragment_path에 active를 가지면 active를 draft로 대체 (미리보기)
    const mergedMap = new Map<string, FragmentRow>();
    for (const f of activeFrags ?? []) mergedMap.set(f.fragment_path, f);
    if (draftFrag) mergedMap.set(draftFrag.fragment_path, draftFrag);

    const composeInputs: Fragment[] = Array.from(mergedMap.values())
      .filter((f) => !!f.generated_yaml)
      .map((f) => ({
        id: f.id,
        fragment_path: f.fragment_path,
        generated_yaml: f.generated_yaml as string,
        imports: (f.imports ?? []) as string[],
      }));

    let composedYaml: string;
    try {
      composedYaml = composeYaml(parent.body_yaml, composeInputs);
    } catch (err) {
      throw new ApiError('internal_error', 'compose failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    log.info('compose preview', {
      rule_id: ruleId,
      parent_version: parent.version,
      fragments_used: composeInputs.length,
      draft_included: !!draftFrag,
    });

    return jsonResponse(200, {
      rule_id: ruleId,
      parent_version: parent.version,
      parent_yaml: parent.body_yaml,
      composed_yaml: composedYaml,
      fragments_used: composeInputs.map((f) => {
        const status = mergedMap.get(f.fragment_path)?.status ?? 'unknown';
        return { id: f.id, fragment_path: f.fragment_path, status };
      }),
      draft_included: !!draftFrag,
    }, log.requestId);
  } catch (err) {
    log.error('gridge-rule-compose-preview failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

interface FragmentRow {
  id: string;
  fragment_path: string;
  generated_yaml: string | null;
  imports: string[] | null;
  status: 'draft' | 'active' | 'archived';
}
