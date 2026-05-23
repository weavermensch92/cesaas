/**
 * POST /gridge-fragment-build — 위버 자연어 → R_10.11 LLM → fragment YAML 생성.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * harness: 2
 *
 * Body:
 *   {
 *     "target_rule_id": "R_10.06_PromptTemplates",
 *     "target_path":    "templates.voice_studio_survey_build",
 *     "nl_text":        "system에 'markdown fence 절대 금지' 한 줄 추가",
 *     "fragment_id"?:   "uuid"      // 기존 draft 갱신 시
 *   }
 *
 * 응답:
 *   {
 *     "fragment_id": "uuid",
 *     "generated_yaml": "id: R_10.06.003\nmodel: ...\n",
 *     "model": "claude-sonnet-4-6",
 *     "rule_version": "1.0",
 *     "usage": { input_tokens, output_tokens, ... }
 *   }
 *
 * 실패:
 *   400 bad_request       — body 누락 / rule_id 형식 오류
 *   422 validation_failed — nl_text 너무 짧음·길음
 *   502 llm_failed        — R_10.11 호출 실패 또는 YAML parse 실패
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { callRule } from 'shared/llm.ts';
import { getSchemaHint } from 'shared/rule_schema_hints.ts';
import { parse as parseYaml } from 'yaml';

const ROUTE = '/gridge-fragment-build';

interface BuildBody {
  target_rule_id: string;
  target_path: string;
  nl_text: string;
  fragment_id?: string;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);

    const body = await parseBody(req);
    const schemaHint = getSchemaHint(body.target_rule_id, body.target_path);

    // userText 빌드 — R_10.11.rule_fragment_build의 user 템플릿에 vars 주입.
    // callRule은 prompt template의 user 텍스트 placeholder({target_rule_id} 등)을 자동 치환 안 함 —
    // 대신 userText로 전체 user 메시지 전달.
    const userText = [
      `target_rule_id: ${body.target_rule_id}`,
      `target_path:    ${body.target_path}`,
      '',
      'schema_hint:',
      schemaHint.split('\n').map((l) => `  ${l}`).join('\n'),
      '',
      '위버 자연어 의도:',
      body.nl_text,
      '',
      '위 의도를 target_path 위치에 들어갈 YAML 조각으로 출력하라.',
    ].join('\n');

    let result;
    try {
      result = await callRule('R_10.11_RuleBuilder', 'rule_fragment_build', {
        userText,
        context: {
          target_rule_id: body.target_rule_id,
          target_path: body.target_path,
          actor: admin.email,
        },
        functionName: ROUTE,
        requestId: log.requestId,
      });
    } catch (err) {
      throw new ApiError('llm_failed', 'R_10.11 rule_fragment_build call failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    const generatedYaml = stripJsonOrYamlEnvelope(result.text);
    // YAML parse 검증 (저장 전)
    try {
      parseYaml(generatedYaml);
    } catch (err) {
      throw new ApiError('llm_failed', 'LLM output is not valid YAML', {
        reason: err instanceof Error ? err.message : String(err),
        sample: generatedYaml.slice(0, 400),
      });
    }

    // rule_fragments INSERT or UPDATE
    let fragmentId: string;
    if (body.fragment_id) {
      const { data, error } = await db()
        .from('rule_fragments')
        .update({
          nl_text: body.nl_text,
          generated_yaml: generatedYaml,
          edited_by: admin.email,
        })
        .eq('id', body.fragment_id)
        .eq('status', 'draft')
        .select('id')
        .single();
      if (error || !data) {
        throw new ApiError('internal_error', 'fragment update failed', {
          db: error?.message ?? 'not found or not draft',
        });
      }
      fragmentId = data.id as string;
    } else {
      const { data, error } = await db()
        .from('rule_fragments')
        .insert({
          rule_id: body.target_rule_id,
          fragment_path: body.target_path,
          nl_text: body.nl_text,
          generated_yaml: generatedYaml,
          status: 'draft',
          edited_by: admin.email,
        })
        .select('id')
        .single();
      if (error || !data) {
        throw new ApiError('internal_error', 'fragment insert failed', {
          db: error?.message ?? 'unknown',
        });
      }
      fragmentId = data.id as string;
    }

    log.info('fragment built', {
      fragment_id: fragmentId,
      target_rule_id: body.target_rule_id,
      target_path: body.target_path,
      yaml_bytes: new TextEncoder().encode(generatedYaml).length,
      model: result.model,
      usage: result.usage,
      actor: admin.email,
    });

    return jsonResponse(200, {
      fragment_id: fragmentId,
      generated_yaml: generatedYaml,
      model: result.model,
      rule_version: result.ruleVersion,
      usage: result.usage,
    }, log.requestId);
  } catch (err) {
    log.error('gridge-fragment-build failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseBody(req: Request): Promise<BuildBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'body must be JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;

  if (typeof o.target_rule_id !== 'string' || !o.target_rule_id) {
    throw new ApiError('bad_request', 'target_rule_id required');
  }
  if (!/^R_10\.\d+_\w+$/.test(o.target_rule_id)) {
    throw new ApiError('bad_request', `invalid target_rule_id: ${o.target_rule_id}`);
  }
  if (typeof o.target_path !== 'string' || !o.target_path) {
    throw new ApiError('bad_request', 'target_path required');
  }
  if (typeof o.nl_text !== 'string') {
    throw new ApiError('bad_request', 'nl_text required (string)');
  }
  const nl = o.nl_text.trim();
  if (nl.length < 8) {
    throw new ApiError('validation_failed', 'nl_text too short (min 8 chars)');
  }
  if (nl.length > 4000) {
    throw new ApiError('validation_failed', 'nl_text too long (max 4000)');
  }
  return {
    target_rule_id: o.target_rule_id,
    target_path: o.target_path,
    nl_text: nl,
    ...(typeof o.fragment_id === 'string' && o.fragment_id ? { fragment_id: o.fragment_id } : {}),
  };
}

/** ```yaml ... ``` 또는 ```json ... ``` 같은 markdown fence 제거. */
function stripJsonOrYamlEnvelope(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  const firstNewline = t.indexOf('\n');
  const end = t.lastIndexOf('```');
  if (firstNewline < 0 || end <= firstNewline) return t;
  return t.slice(firstNewline + 1, end).trim();
}
