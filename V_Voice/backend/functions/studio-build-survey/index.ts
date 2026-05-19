/**
 * POST /studio-build-survey — 자연어 → 설문 spec.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['V_가설']
 *
 * Body:
 *   {
 *     "input_text": "Mining 산업 대상 30문항 ...",
 *     "target_audience": "dealer" | "visitor",
 *     "language": "ko" | "en" | "ru"   // 위버 작업 언어 (기본 ko)
 *   }
 *
 * 응답:
 *   {
 *     "draft_id": uuid,
 *     "spec": {...},                 // SurveySpec
 *     "model": "claude-opus-4-7",
 *     "rule_version": "...",
 *     "prompt_version": "..."
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { callRule } from 'shared/llm.ts';

const ROUTE = '/studio-build-survey';

interface BuildBody {
  input_text: string;
  target_audience: 'dealer' | 'visitor';
  language?: string;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);
    if (admin.role !== 'gridge_admin') {
      throw new ApiError('forbidden', 'Studio is gridge_admin only', { role: admin.role });
    }

    const body = await parseBody(req);

    // 사용자 자연어를 R_10.06 voice_studio_survey_build user 템플릿의 {input}에 치환
    const result = await callRule('R_10.06_PromptTemplates', 'voice_studio_survey_build', {
      userText: buildUserText(body),
      context: { actor: admin.email, target: body.target_audience },
    });
    log.info('llm called', {
      model: result.model, rule_version: result.ruleVersion, prompt_version: result.promptVersion,
      input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
    });

    const spec = parseSpec(result.text);

    // draft 저장
    const { data: draft, error: insErr } = await db()
      .from('studio_drafts')
      .insert({
        actor: admin.email,
        target_audience: body.target_audience,
        input_text: body.input_text,
        language: body.language ?? 'ko',
        llm_model: result.model,
        llm_rule_version: result.ruleVersion,
        llm_prompt_version: result.promptVersion,
        llm_raw: result.text,
        llm_spec: spec,
        status: 'draft',
      })
      .select('id')
      .single();
    if (insErr) throw new ApiError('internal_error', 'draft INSERT failed', { db: insErr.message });

    return jsonResponse(200, {
      draft_id: draft.id,
      spec,
      model: result.model,
      rule_version: result.ruleVersion,
      prompt_version: result.promptVersion,
      usage: result.usage,
    }, log.requestId);
  } catch (err) {
    log.error('studio-build-survey failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseBody(req: Request): Promise<BuildBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'body must be JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;
  const input_text = typeof o.input_text === 'string' ? o.input_text.trim() : '';
  const target_audience = o.target_audience === 'visitor' ? 'visitor' : 'dealer';
  if (!input_text || input_text.length < 8) {
    throw new ApiError('validation_failed', 'input_text required (min 8 chars)');
  }
  if (input_text.length > 4000) {
    throw new ApiError('validation_failed', 'input_text too long (max 4000)');
  }
  return {
    input_text,
    target_audience,
    ...(typeof o.language === 'string' ? { language: o.language } : {}),
  };
}

function buildUserText(b: BuildBody): string {
  // R_10.06.voice_studio_survey_build.user 의 {input} placeholder 치환을 수동 처리.
  // 추가 메타도 동봉 — target_audience·language·기본값.
  return [
    `target_audience: ${b.target_audience}`,
    `working_language: ${b.language ?? 'ko'}`,
    `count_target: ${b.target_audience === 'dealer' ? 31 : 18}`,
    `must_include: ['nps', 'consent (data_collection)']`,
    `axis_required (visitor): ['scale','usage','fleet_size','decision_role']`,
    `axis_required (dealer):  ['scale','usage','annual_operating_hours','annual_deal_rub','fleet_size','decision_role']`,
    '',
    '아래 자연어 요청에 맞춰 설문 spec JSON 한 덩어리를 출력한다. 설명 텍스트·markdown fence 금지.',
    'spec schema:',
    '  {',
    '    "title": string,',
    '    "description"?: string,',
    '    "language_default": "ru"|"en"|"ko",',
    '    "estimated_minutes"?: number,',
    '    "questions": [{',
    '      "type": "single_select"|"multi_select"|"scale_1_5"|"nps"|"text_short"|"text_long"|"slider"|"consent",',
    '      "title_ru": string, "title_en": string, "title_ko": string,',
    '      "axis"?: string,',
    '      "options"?: [{"value": string, "label_ru": string, "label_en": string, "label_ko": string}],',
    '      "required"?: boolean',
    '    }]',
    '  }',
    '',
    '요청:',
    b.input_text,
  ].join('\n');
}

interface Spec { title: string; questions: unknown[] }

function parseSpec(text: string): Spec {
  const stripped = stripJsonEnvelope(text);
  let raw: unknown;
  try { raw = JSON.parse(stripped); }
  catch (e) {
    throw new ApiError('llm_failed', 'LLM output is not valid JSON', {
      reason: e instanceof Error ? e.message : 'parse failed',
      sample: text.slice(0, 400),
    });
  }
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('llm_failed', 'spec must be object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || !obj.title) {
    throw new ApiError('llm_failed', 'spec.title required (string)');
  }
  if (!Array.isArray(obj.questions) || obj.questions.length === 0) {
    throw new ApiError('llm_failed', 'spec.questions array required');
  }
  return obj as Spec;
}

function stripJsonEnvelope(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    const end = t.lastIndexOf('```');
    return t.slice(t.indexOf('\n') + 1, end > 3 ? end : t.length).trim();
  }
  return t;
}
