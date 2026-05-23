/**
 * POST /gridge-rule-compose-publish — drafts→active 전환 + 합성 YAML 평면화 → publish_rule RPC.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * harness: 2
 *
 * Body:
 *   {
 *     "rule_id": "R_10.06_PromptTemplates",
 *     "draft_fragment_ids": ["uuid1", "uuid2"],
 *     "version":  "2026-05-23.005",        // 필수 (자동 bump는 클라이언트에서)
 *     "notes"?:   "voice_studio_survey_build system fence 금지 추가"
 *   }
 *
 * 처리:
 *   1. requireAdmin
 *   2. draft 검증 (parse OK, 같은 rule_id)
 *   3. 같은 (rule_id, fragment_path) 기존 active → archived
 *   4. drafts → active
 *   5. compose(parent active body_yaml, all active fragments)
 *   6. 평면 YAML 안 version: 필드 교체
 *   7. publish_rule RPC (rule_versions 신규 active 등록)
 *
 * 응답:
 *   {
 *     "rule_id": "R_10.06_PromptTemplates",
 *     "rule_version_id": "uuid",
 *     "version": "2026-05-23.005",
 *     "previous_version": "2026-05-23.004",
 *     "fragments_activated": ["uuid1"],
 *     "fragments_archived":  ["uuid_old"],
 *     "composed_bytes": 9420
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { composeYaml, replaceTopVersion, type Fragment } from 'shared/rule_compose.ts';
import { parse as parseYaml } from 'yaml';

const ROUTE = '/gridge-rule-compose-publish';

interface PublishBody {
  rule_id: string;
  draft_fragment_ids: string[];
  version: string;
  notes?: string;
}

interface FragmentRow {
  id: string;
  rule_id: string;
  fragment_path: string;
  generated_yaml: string | null;
  imports: string[] | null;
  status: 'draft' | 'active' | 'archived';
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);

    const body = await parseBody(req);

    // 1) drafts 조회 + 검증
    const { data: drafts, error: draftErr } = await db()
      .from('rule_fragments')
      .select('id, rule_id, fragment_path, generated_yaml, imports, status')
      .in('id', body.draft_fragment_ids)
      .returns<FragmentRow[]>();
    if (draftErr) throw new ApiError('internal_error', 'drafts fetch failed', { db: draftErr.message });
    if (!drafts || drafts.length !== body.draft_fragment_ids.length) {
      throw new ApiError('validation_failed', 'some drafts not found', {
        requested: body.draft_fragment_ids.length,
        found: drafts?.length ?? 0,
      });
    }
    for (const d of drafts) {
      if (d.rule_id !== body.rule_id) {
        throw new ApiError('validation_failed', `fragment ${d.id} rule_id mismatch (${d.rule_id} vs ${body.rule_id})`);
      }
      if (d.status !== 'draft') {
        throw new ApiError('validation_failed', `fragment ${d.id} is not draft (status=${d.status})`);
      }
      if (!d.generated_yaml) {
        throw new ApiError('validation_failed', `fragment ${d.id} has no generated_yaml`);
      }
      try { parseYaml(d.generated_yaml); }
      catch (err) {
        throw new ApiError('validation_failed', `fragment ${d.id} YAML parse failed`, {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2) parent active body_yaml + version
    const { data: parent, error: parentErr } = await db()
      .from('rule_versions')
      .select('id, version, body_yaml')
      .eq('rule_id', body.rule_id)
      .eq('status', 'active')
      .maybeSingle<{ id: string; version: string; body_yaml: string }>();
    if (parentErr) throw new ApiError('internal_error', 'parent fetch failed', { db: parentErr.message });
    if (!parent) throw new ApiError('not_found', `no active row for ${body.rule_id}`);
    if (parent.version === body.version) {
      throw new ApiError('validation_failed',
        `version "${body.version}" 은(는) 현재 active와 동일. bump 필요`,
        { previous_version: parent.version });
    }

    // 3) 같은 (rule_id, fragment_path) 기존 active → archived
    const paths = drafts.map((d) => d.fragment_path);
    const { data: existing, error: existErr } = await db()
      .from('rule_fragments')
      .select('id, fragment_path')
      .eq('rule_id', body.rule_id)
      .eq('status', 'active')
      .in('fragment_path', paths)
      .returns<{ id: string; fragment_path: string }[]>();
    if (existErr) throw new ApiError('internal_error', 'existing fragments fetch failed', { db: existErr.message });

    const archivedIds: string[] = [];
    if (existing && existing.length > 0) {
      const ids = existing.map((e) => e.id);
      const { error: archErr } = await db()
        .from('rule_fragments')
        .update({ status: 'archived', archived_at: new Date().toISOString() })
        .in('id', ids);
      if (archErr) throw new ApiError('internal_error', 'archive failed', { db: archErr.message });
      archivedIds.push(...ids);
    }

    // 4) drafts → active
    const { error: actErr } = await db()
      .from('rule_fragments')
      .update({ status: 'active', edited_by: admin.email })
      .in('id', body.draft_fragment_ids);
    if (actErr) {
      // 가능한 롤백: archived → active 복구. 단순 구현 — 1회 시도.
      if (archivedIds.length > 0) {
        await db()
          .from('rule_fragments')
          .update({ status: 'active', archived_at: null })
          .in('id', archivedIds);
      }
      throw new ApiError('internal_error', 'activate failed', { db: actErr.message });
    }

    // 5) 모든 active fragments 재조회 (방금 활성화된 것 + 다른 path의 기존 active)
    const { data: allActive, error: allErr } = await db()
      .from('rule_fragments')
      .select('id, fragment_path, generated_yaml, imports')
      .eq('rule_id', body.rule_id)
      .eq('status', 'active')
      .returns<{ id: string; fragment_path: string; generated_yaml: string | null; imports: string[] | null }[]>();
    if (allErr) throw new ApiError('internal_error', 'active fragments refetch failed', { db: allErr.message });

    const composeInputs: Fragment[] = (allActive ?? [])
      .filter((f) => !!f.generated_yaml)
      .map((f) => ({
        id: f.id,
        fragment_path: f.fragment_path,
        generated_yaml: f.generated_yaml as string,
        imports: (f.imports ?? []) as string[],
      }));

    // 6) compose
    let composedYaml: string;
    try {
      composedYaml = composeYaml(parent.body_yaml, composeInputs);
      composedYaml = replaceTopVersion(composedYaml, body.version);
    } catch (err) {
      throw new ApiError('internal_error', 'compose failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    // 7) body_json 파싱
    let bodyJson: Record<string, unknown>;
    try {
      bodyJson = parseYaml(composedYaml) as Record<string, unknown>;
    } catch (err) {
      throw new ApiError('internal_error', 'composed YAML parse failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    // 8) publish_rule RPC
    const notes = body.notes ?? `gridge-rule-compose-publish ${body.rule_id}@${body.version} (fragments: ${body.draft_fragment_ids.length})`;
    const { data: newId, error: rpcErr } = await db().rpc('publish_rule', {
      p_rule_id:   body.rule_id,
      p_version:   body.version,
      p_body_yaml: composedYaml,
      p_body_json: bodyJson,
      p_actor:     admin.email,
      p_notes:     notes,
    });
    if (rpcErr) {
      throw new ApiError('internal_error', 'publish_rule RPC failed', { db: rpcErr.message });
    }

    const composedBytes = new TextEncoder().encode(composedYaml).length;
    log.info('compose publish', {
      rule_id: body.rule_id,
      rule_version_id: newId,
      version: body.version,
      previous_version: parent.version,
      fragments_activated: body.draft_fragment_ids.length,
      fragments_archived: archivedIds.length,
      composed_bytes: composedBytes,
      actor: admin.email,
    });

    return jsonResponse(200, {
      rule_id: body.rule_id,
      rule_version_id: newId as string,
      version: body.version,
      previous_version: parent.version,
      fragments_activated: body.draft_fragment_ids,
      fragments_archived: archivedIds,
      composed_bytes: composedBytes,
    }, log.requestId);
  } catch (err) {
    log.error('gridge-rule-compose-publish failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseBody(req: Request): Promise<PublishBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'body must be JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;

  if (typeof o.rule_id !== 'string' || !o.rule_id) {
    throw new ApiError('bad_request', 'rule_id required');
  }
  if (!/^R_10\.\d+_\w+$/.test(o.rule_id)) {
    throw new ApiError('bad_request', `invalid rule_id: ${o.rule_id}`);
  }
  if (!Array.isArray(o.draft_fragment_ids) || o.draft_fragment_ids.length === 0) {
    throw new ApiError('bad_request', 'draft_fragment_ids required (non-empty array)');
  }
  if (o.draft_fragment_ids.length > 20) {
    throw new ApiError('validation_failed', 'too many drafts at once (max 20)');
  }
  const ids = (o.draft_fragment_ids as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (ids.length !== o.draft_fragment_ids.length) {
    throw new ApiError('bad_request', 'draft_fragment_ids must be strings');
  }
  if (typeof o.version !== 'string' || !o.version) {
    throw new ApiError('bad_request', 'version required');
  }

  return {
    rule_id: o.rule_id,
    draft_fragment_ids: ids,
    version: o.version,
    ...(typeof o.notes === 'string' && o.notes ? { notes: o.notes } : {}),
  };
}
