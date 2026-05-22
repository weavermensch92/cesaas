/**
 * POST /gridge-rule-publish — R_10 룰 편집본 publish (이전 active → archived + 새 active).
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * harness: 2
 *
 * Body:
 *   {
 *     "rule_id": "R_10.06_PromptTemplates",
 *     "body_yaml": "rule_id: R_10.06_PromptTemplates\n...전체 YAML...",
 *     "version"?: "2026-05-23.004",   // 생략 시 YAML version 필드 사용
 *     "notes"?: "voice_studio_survey_build system 강화"
 *   }
 *
 * 응답:
 *   {
 *     "rule_id": "R_10.06_PromptTemplates",
 *     "version": "2026-05-23.004",
 *     "previous_version": "2026-05-23.003",
 *     "new_row_id": "uuid",
 *     "body_bytes": 9120
 *   }
 *
 * 실패:
 *   400 bad_request       — body 누락 / rule_id 형식 오류
 *   422 validation_failed — YAML parse 실패 / rule_id 불일치 / version 누락·중복
 *   500 internal_error    — publish_rule RPC 실패
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { parse as parseYaml } from 'yaml';

const ROUTE = '/gridge-rule-publish';

interface PublishBody {
  rule_id: string;
  body_yaml: string;
  version?: string;
  notes?: string;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);

    const body = await parseBody(req);

    // YAML 파싱 + 메타 검증
    let bodyJson: Record<string, unknown>;
    try {
      bodyJson = parseYaml(body.body_yaml) as Record<string, unknown>;
    } catch (err) {
      throw new ApiError('validation_failed', 'YAML parse failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    if (!bodyJson || typeof bodyJson !== 'object') {
      throw new ApiError('validation_failed', 'YAML root must be object');
    }
    if (bodyJson.rule_id && bodyJson.rule_id !== body.rule_id) {
      throw new ApiError('validation_failed', 'rule_id mismatch', {
        body_rule_id: body.rule_id,
        yaml_rule_id: bodyJson.rule_id,
      });
    }

    const version = body.version ?? (bodyJson.version != null ? String(bodyJson.version) : null);
    if (!version) {
      throw new ApiError('validation_failed', 'version required (body.version or YAML version:)');
    }

    // 이전 active 조회 — 동일 버전 차단
    const { data: prev, error: prevErr } = await db()
      .from('rule_versions')
      .select('id, version')
      .eq('rule_id', body.rule_id)
      .eq('status', 'active')
      .maybeSingle<{ id: string; version: string }>();
    if (prevErr) {
      throw new ApiError('internal_error', 'prev fetch failed', { db: prevErr.message });
    }
    if (prev?.version === version) {
      throw new ApiError('validation_failed',
        `version "${version}" already active. bump YAML version: field or pass body.version`,
        { previous_version: prev.version });
    }

    const notes = body.notes ?? `gridge-rule-publish ${body.rule_id}@${version}`;

    const { data: newId, error: rpcErr } = await db().rpc('publish_rule', {
      p_rule_id:   body.rule_id,
      p_version:   version,
      p_body_yaml: body.body_yaml,
      p_body_json: bodyJson,
      p_actor:     admin.email,
      p_notes:     notes,
    });
    if (rpcErr) {
      throw new ApiError('internal_error', 'publish_rule RPC failed', { db: rpcErr.message });
    }

    const bodyBytes = new TextEncoder().encode(body.body_yaml).length;
    log.info('gridge rule published', {
      rule_id: body.rule_id,
      version,
      previous_version: prev?.version ?? null,
      actor: admin.email,
      body_bytes: bodyBytes,
    });

    return jsonResponse(200, {
      rule_id: body.rule_id,
      version,
      previous_version: prev?.version ?? null,
      new_row_id: newId as string,
      body_bytes: bodyBytes,
    }, log.requestId);
  } catch (err) {
    log.error('gridge-rule-publish failed', err);
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
    throw new ApiError('bad_request', `invalid rule_id: ${o.rule_id} (expected R_10.NN_Name)`);
  }
  if (typeof o.body_yaml !== 'string' || o.body_yaml.length < 10) {
    throw new ApiError('bad_request', 'body_yaml required (non-empty string)');
  }
  return {
    rule_id: o.rule_id,
    body_yaml: o.body_yaml,
    ...(typeof o.version === 'string' && o.version ? { version: o.version } : {}),
    ...(typeof o.notes === 'string' ? { notes: o.notes } : {}),
  };
}
