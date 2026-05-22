/**
 * POST /studio-build-survey — 자연어 또는 base_spec → 설문 spec.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['V_가설']
 * harness: 1
 *
 * Body (신규 빌드):
 *   {
 *     "input_text": "Mining 산업 대상 30문항 ...",
 *     "target_audiences": ["dealer"]                 // 또는 ["dealer","visitor"]
 *     "language"?: "ko" | "en" | "ru"
 *   }
 *
 * Body (재생성/기존수정):
 *   {
 *     "input_text"?: string,                          // 없으면 빈 문자열 OK (edit_notes만으로 동작)
 *     "target_audiences": [...],                       // 통상 base_spec의 target 1개
 *     "language"?: string,
 *     "base_spec": {...},                              // 기존 spec
 *     "edit_notes": "광산 산업 변수 보강",
 *     "parent_survey_id"?: "survey_v1_dealer_..."     // 기존 설문 ID
 *   }
 *
 * 호환: 레거시 단일 target_audience 필드도 그대로 수용 (1-element array로 변환).
 *
 * 응답:
 *   {
 *     "brief_group_id": uuid,
 *     "drafts": [
 *       {
 *         "target_audience": "dealer",
 *         "draft_id": uuid,
 *         "spec": {...},
 *         "warnings": [{ code, severity, question_ids, message_ko, suggestion_patch? }],
 *         "model": "...", "rule_version": "...", "prompt_version": "...",
 *         "usage": { input_tokens, output_tokens, ... }
 *       }
 *     ]
 *   }
 *
 * 부분 실패: 한쪽 target만 실패하면 그 target에 대한 draft 엔트리에 error 필드 포함, 다른 target은 정상 반환.
 * 양쪽 모두 실패하면 502 llm_failed.
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { callRule } from 'shared/llm.ts';
import {
  lintSurveySpec,
  type LintWarning,
  type StudioSpec,
  type TargetAudience,
} from 'shared/studio_lint.ts';

const ROUTE = '/studio-build-survey';
const TARGET_AUDIENCES: ReadonlyArray<TargetAudience> = ['dealer', 'visitor'];

interface BuildBody {
  input_text: string;
  target_audiences: TargetAudience[];
  language: string;
  // 편집 분기
  base_spec?: Record<string, unknown>;
  edit_notes?: string;
  parent_survey_id?: string;
}

interface DraftEntry {
  target_audience: TargetAudience;
  draft_id?: string;
  spec?: StudioSpec;
  warnings?: LintWarning[];
  model?: string;
  rule_version?: string;
  prompt_version?: string | null;
  usage?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);
    // requireAdmin이 admin/super_admin만 통과시키므로 별도 role 검사 불필요.

    const body = await parseBody(req);
    const briefGroupId = crypto.randomUUID();
    const isEdit = !!(body.base_spec && body.edit_notes);

    // target별 병렬 LLM 호출 + draft INSERT
    const results = await Promise.all(
      body.target_audiences.map((t) => buildOne(t, body, isEdit, admin.email, briefGroupId, log)),
    );

    // 양쪽 모두 실패 시 502
    const succeeded = results.filter((r) => !r.error);
    if (succeeded.length === 0) {
      const first = results[0]?.error;
      throw new ApiError('llm_failed', first?.message ?? 'all builds failed', {
        errors: results.map((r) => r.error),
      });
    }

    log.info('studio build complete', {
      brief_group_id: briefGroupId,
      targets: body.target_audiences,
      ok_count: succeeded.length,
      mode: isEdit ? 'edit' : 'fresh',
    });

    return jsonResponse(200, {
      brief_group_id: briefGroupId,
      drafts: results,
    }, log.requestId);
  } catch (err) {
    log.error('studio-build-survey failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

// ─── 1 target 빌드 (LLM + lint + draft INSERT) ──────────────────────────────

async function buildOne(
  target: TargetAudience,
  body: BuildBody,
  isEdit: boolean,
  actor: string,
  briefGroupId: string,
  log: ReturnType<typeof requestLogger>,
): Promise<DraftEntry> {
  try {
    const promptKey = isEdit ? 'voice_studio_survey_edit' : 'voice_studio_survey_build';
    const userText = buildUserText(target, body, isEdit);

    const result = await callRule('R_10.06_PromptTemplates', promptKey, {
      userText,
      context: { actor, target, mode: isEdit ? 'edit' : 'fresh' },
    });
    log.info('llm called', {
      target, prompt_key: promptKey,
      model: result.model, rule_version: result.ruleVersion,
      input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
    });

    let spec = parseSpec(result.text);
    spec = markAiGenerated(spec, isEdit, body.base_spec as StudioSpec | undefined);

    // 서버 lint (전체 5종)
    const warnings = lintSurveySpec(spec, { target_audience: target, include_semantic: true });

    // draft 저장 (target당 1행)
    const { data: draft, error: insErr } = await db()
      .from('studio_drafts')
      .insert({
        actor,
        target_audience: target,
        input_text: body.input_text,
        language: body.language,
        llm_model: result.model,
        llm_rule_version: result.ruleVersion,
        llm_prompt_version: result.promptVersion,
        llm_raw: result.text,
        llm_spec: spec,
        warnings,
        status: 'draft',
        brief_group_id: briefGroupId,
        origin: isEdit ? 'regenerated' : 'fresh',
        parent_survey_id: body.parent_survey_id ?? null,
        edit_notes: body.edit_notes ?? null,
      })
      .select('id')
      .single();
    if (insErr) {
      return {
        target_audience: target,
        error: { code: 'internal_error', message: `draft INSERT failed: ${insErr.message}` },
      };
    }

    return {
      target_audience: target,
      draft_id: draft.id,
      spec,
      warnings,
      model: result.model,
      rule_version: result.ruleVersion,
      prompt_version: result.promptVersion,
      usage: result.usage as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'internal_error';
    const message = err instanceof Error ? err.message : 'unknown';
    const details = err instanceof ApiError ? err.details : undefined;
    log.error('buildOne failed', { target, code, message, details });
    return {
      target_audience: target,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    };
  }
}

// ─── 입력 파싱 ───────────────────────────────────────────────────────────────

async function parseBody(req: Request): Promise<BuildBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'body must be JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;

  const input_text = typeof o.input_text === 'string' ? o.input_text.trim() : '';
  const language = typeof o.language === 'string' && o.language ? o.language : 'ko';

  // target_audiences (신규) 또는 target_audience (레거시)
  let targets: TargetAudience[] = [];
  if (Array.isArray(o.target_audiences)) {
    targets = (o.target_audiences as unknown[])
      .map((v) => (TARGET_AUDIENCES.includes(v as TargetAudience) ? (v as TargetAudience) : null))
      .filter((v): v is TargetAudience => v !== null);
    // dedupe
    targets = Array.from(new Set(targets));
  } else if (typeof o.target_audience === 'string' &&
             TARGET_AUDIENCES.includes(o.target_audience as TargetAudience)) {
    targets = [o.target_audience as TargetAudience];
  }
  if (targets.length === 0) {
    throw new ApiError('validation_failed', 'target_audiences must be non-empty array of dealer|visitor');
  }
  if (targets.length > 2) {
    throw new ApiError('validation_failed', 'target_audiences max 2 (dealer + visitor)');
  }

  // 편집 분기 입력
  const base_spec = o.base_spec && typeof o.base_spec === 'object'
    ? o.base_spec as Record<string, unknown>
    : undefined;
  const edit_notes = typeof o.edit_notes === 'string' && o.edit_notes.trim()
    ? o.edit_notes.trim()
    : undefined;
  const parent_survey_id = typeof o.parent_survey_id === 'string' && o.parent_survey_id
    ? o.parent_survey_id
    : undefined;

  const isEdit = !!(base_spec && edit_notes);

  if (!isEdit) {
    // 신규 빌드 — input_text 필수
    if (!input_text || input_text.length < 8) {
      throw new ApiError('validation_failed', 'input_text required (min 8 chars) for fresh build');
    }
  }
  if (input_text.length > 4000) {
    throw new ApiError('validation_failed', 'input_text too long (max 4000)');
  }
  if (edit_notes && edit_notes.length > 2000) {
    throw new ApiError('validation_failed', 'edit_notes too long (max 2000)');
  }

  return {
    input_text,
    target_audiences: targets,
    language,
    ...(base_spec ? { base_spec } : {}),
    ...(edit_notes ? { edit_notes } : {}),
    ...(parent_survey_id ? { parent_survey_id } : {}),
  };
}

// ─── userText 빌더 ─────────────────────────────────────────────────────────

function buildUserText(target: TargetAudience, b: BuildBody, isEdit: boolean): string {
  const count = target === 'dealer' ? 31 : 18;
  const axisRequired = target === 'dealer'
    ? `['scale','usage','annual_operating_hours','annual_deal_rub','fleet_size','decision_role']`
    : `['scale','usage','fleet_size','decision_role']`;

  const header = [
    `target_audience: ${target}`,
    `working_language: ${b.language}`,
    `count_target: ${count}`,
    `must_include: ['nps', 'consent (data_collection)']`,
    `axis_required: ${axisRequired}`,
  ].join('\n');

  if (isEdit) {
    return [
      header,
      '',
      'edit_notes (위버 수정 지시):',
      b.edit_notes ?? '(없음)',
      '',
      ...(b.input_text ? ['추가 자연어 컨텍스트:', b.input_text, ''] : []),
      'base_spec (원본 spec, JSON):',
      JSON.stringify(b.base_spec ?? {}, null, 2),
      '',
      '위 base_spec를 edit_notes에 맞춰 수정/보강하여 동일 schema의 JSON 한 덩어리로 출력하라.',
    ].join('\n');
  }

  return [
    header,
    '',
    '아래 자연어 요청에 맞춰 설문 spec JSON 한 덩어리를 출력한다. 설명 텍스트·markdown fence 금지.',
    '',
    '요청:',
    b.input_text,
  ].join('\n');
}

// ─── spec 파싱 + ai_generated 마킹 ──────────────────────────────────────────

function parseSpec(text: string): StudioSpec {
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
  return obj as unknown as StudioSpec;
}

function stripJsonEnvelope(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    const end = t.lastIndexOf('```');
    return t.slice(t.indexOf('\n') + 1, end > 3 ? end : t.length).trim();
  }
  return t;
}

/**
 * 신규 빌드: 모든 질문에 ai_generated=true 강제.
 * 편집 분기: base_spec의 ai_generated/edited_at을 가능하면 보존. id 매칭되는 질문은 원본 플래그 사용.
 *           새로 추가됐거나 base_spec에 없던 id면 ai_generated=true.
 */
function markAiGenerated(
  spec: StudioSpec,
  isEdit: boolean,
  baseSpec?: StudioSpec,
): StudioSpec {
  const qs = Array.isArray(spec.questions) ? spec.questions : [];

  if (!isEdit) {
    return {
      ...spec,
      questions: qs.map((q) => ({ ...q, ai_generated: true })),
    };
  }

  const baseMap = new Map<string, { ai_generated?: boolean; edited_at?: string | null }>();
  for (const bq of baseSpec?.questions ?? []) {
    if (typeof bq.id === 'string' && bq.id) {
      baseMap.set(bq.id, { ai_generated: bq.ai_generated, edited_at: bq.edited_at ?? null });
    }
  }

  return {
    ...spec,
    questions: qs.map((q) => {
      const id = typeof q.id === 'string' ? q.id : '';
      const prev = id ? baseMap.get(id) : undefined;
      if (prev) {
        // LLM이 반환한 ai_generated 플래그를 신뢰하되, 누락 시 base를 보존
        return {
          ...q,
          ai_generated: typeof q.ai_generated === 'boolean'
            ? q.ai_generated
            : (prev.ai_generated ?? false),
          edited_at: q.edited_at ?? prev.edited_at ?? null,
        };
      }
      // base에 없던 id (= 신규 추가) → ai_generated=true
      return { ...q, ai_generated: true };
    }),
  };
}
