/**
 * GET /studio-load-survey?survey_id=... — 기존 설문을 Studio 편집기로 로드.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * harness: 1
 *
 * 1. surveys + survey_questions(sort_order) 조회
 * 2. SurveySpec 합성 (각 질문에 ai_generated/edited_at 포함)
 * 3. studio_drafts INSERT — origin='from_existing', parent_survey_id, 새 brief_group_id
 *
 * 응답:
 *   {
 *     "draft_id": uuid,
 *     "brief_group_id": uuid,
 *     "target_audience": "dealer"|"visitor",
 *     "spec": { title, description?, language_default, estimated_minutes?, questions: [...] },
 *     "parent_survey": { id, version_label?, title, created_at }
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/studio-load-survey';

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  target_audience: 'dealer' | 'visitor';
  language_default: string;
  estimated_minutes: number | null;
  version_label: string | null;
  created_at: string;
}

interface QuestionRow {
  id: string;
  type: string;
  title_ru: string;
  title_en: string | null;
  title_ko: string | null;
  axis: string | null;
  options: unknown;
  required: boolean;
  weight: number;
  sort_order: number;
  ai_generated: boolean;
  edited_at: string | null;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    const admin = await requireAdmin(req);
    if (admin.role !== 'gridge_admin') {
      throw new ApiError('forbidden', 'Studio is gridge_admin only', { role: admin.role });
    }

    const url = new URL(req.url);
    const surveyId = url.searchParams.get('survey_id')?.trim();
    if (!surveyId) {
      throw new ApiError('validation_failed', 'survey_id query param required');
    }

    const { data: survey, error: sErr } = await db()
      .from('surveys')
      .select('id, title, description, target_audience, language_default, estimated_minutes, version_label, created_at')
      .eq('id', surveyId)
      .maybeSingle<SurveyRow>();
    if (sErr) {
      throw new ApiError('internal_error', 'survey SELECT failed', { db: sErr.message });
    }
    if (!survey) {
      throw new ApiError('not_found', `survey not found: ${surveyId}`);
    }

    const { data: questions, error: qErr } = await db()
      .from('survey_questions')
      .select('id, type, title_ru, title_en, title_ko, axis, options, required, weight, sort_order, ai_generated, edited_at')
      .eq('survey_id', surveyId)
      .order('sort_order', { ascending: true })
      .returns<QuestionRow[]>();
    if (qErr) {
      throw new ApiError('internal_error', 'questions SELECT failed', { db: qErr.message });
    }

    const spec = {
      id: survey.id,
      title: survey.title,
      ...(survey.description ? { description: survey.description } : {}),
      language_default: survey.language_default,
      ...(survey.estimated_minutes !== null ? { estimated_minutes: survey.estimated_minutes } : {}),
      questions: (questions ?? []).map((q) => ({
        id: q.id,
        type: q.type,
        title_ru: q.title_ru,
        ...(q.title_en ? { title_en: q.title_en } : {}),
        ...(q.title_ko ? { title_ko: q.title_ko } : {}),
        ...(q.axis ? { axis: q.axis } : {}),
        ...(q.options !== null && q.options !== undefined ? { options: q.options } : {}),
        required: q.required,
        weight: q.weight,
        sort_order: q.sort_order,
        ai_generated: q.ai_generated,
        ...(q.edited_at ? { edited_at: q.edited_at } : { edited_at: null }),
      })),
    };

    const briefGroupId = crypto.randomUUID();

    const { data: draft, error: insErr } = await db()
      .from('studio_drafts')
      .insert({
        actor: admin.email,
        target_audience: survey.target_audience,
        input_text: `(loaded from existing survey ${survey.id})`,
        language: survey.language_default,
        llm_spec: spec,
        final_spec: spec,
        status: 'draft',
        brief_group_id: briefGroupId,
        origin: 'from_existing',
        parent_survey_id: survey.id,
      })
      .select('id')
      .single();
    if (insErr) {
      throw new ApiError('internal_error', 'draft INSERT failed', { db: insErr.message });
    }

    log.info('survey loaded into studio', {
      survey_id: survey.id,
      target_audience: survey.target_audience,
      draft_id: draft.id,
      brief_group_id: briefGroupId,
    });

    return jsonResponse(200, {
      draft_id: draft.id,
      brief_group_id: briefGroupId,
      target_audience: survey.target_audience,
      spec,
      parent_survey: {
        id: survey.id,
        title: survey.title,
        ...(survey.version_label ? { version_label: survey.version_label } : {}),
        created_at: survey.created_at,
      },
    }, log.requestId);
  } catch (err) {
    log.error('studio-load-survey failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
