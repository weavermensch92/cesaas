/**
 * GET /voice-response-detail?id=<uuid> — Admin 응답 detail (단건).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * harness: 1
 *
 * 응답:
 *   {
 *     response: { id, created_at, captured_at, respondent_type, dealer_id, device_id,
 *                 survey_id, language, segment, segment_method, segment_confidence,
 *                 nps, future_subscription, consent_data_collection,
 *                 contact_*, target_company, notes, axis_data, preference_axes,
 *                 translations_status, lead_id },
 *     answers: [{
 *       question_id, type, axis, sort_order,
 *       title: { ko, en, ru },
 *       options: [...],            // raw survey_questions.options JSONB
 *       answer,                    // raw user answer (JSONB)
 *       translations: { ko, en, ru } | null,
 *       translation_status: 'pending' | 'done' | 'failed' | null,
 *       translation_model: string | null,
 *       translation_at: timestamp | null
 *     }]
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

interface ResponseRow {
  id: string;
  created_at: string;
  captured_at: string;
  respondent_type: 'dealer' | 'visitor';
  dealer_id: string | null;
  device_id: string | null;
  survey_id: string;
  language: string;
  segment: string | null;
  segment_method: string | null;
  segment_confidence: number | null;
  nps: number | null;
  future_subscription: boolean | null;
  consent_data_collection: boolean | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_opted_in: boolean | null;
  target_company: string | null;
  notes: string | null;
  event: string | null;
  axis_data: Record<string, unknown> | null;
  preference_axes: Record<string, number> | null;
  translations_status: string | null;
  lead_id: string | null;
}

interface AnswerRow {
  question_id: string;
  answer: unknown;
  translations: { ko: string; en: string; ru: string } | null;
  translation_status: string | null;
  translation_model: string | null;
  translation_at: string | null;
}

interface QuestionRow {
  id: string;
  type: string;
  axis: string | null;
  sort_order: number;
  title_ru: string;
  title_en: string | null;
  title_ko: string | null;
  options: unknown;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/voice-response-detail' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) throw new ApiError('validation_failed', 'id required');

    // response 단건
    const { data: resp, error: rErr } = await db()
      .from('responses')
      .select('id, created_at, captured_at, respondent_type, dealer_id, device_id, survey_id, language, segment, segment_method, segment_confidence, nps, future_subscription, consent_data_collection, contact_name, contact_phone, contact_email, contact_opted_in, target_company, notes, event, axis_data, preference_axes, translations_status, lead_id')
      .eq('id', id)
      .maybeSingle();
    if (rErr) throw new ApiError('internal_error', 'response query failed', { db: rErr.message });
    if (!resp) throw new ApiError('not_found', `response not found: ${id}`);

    const response = resp as ResponseRow;

    // 답변 (translations 포함)
    const { data: ans, error: aErr } = await db()
      .from('response_answers')
      .select('question_id, answer, translations, translation_status, translation_model, translation_at')
      .eq('response_id', id);
    if (aErr) throw new ApiError('internal_error', 'answers query failed', { db: aErr.message });

    const answers = (ans ?? []) as AnswerRow[];

    // 해당 survey의 질문 메타 (title·type·axis·options)
    const { data: qs, error: qErr } = await db()
      .from('survey_questions')
      .select('id, type, axis, sort_order, title_ru, title_en, title_ko, options')
      .eq('survey_id', response.survey_id);
    if (qErr) throw new ApiError('internal_error', 'questions query failed', { db: qErr.message });

    const qMap = new Map<string, QuestionRow>();
    for (const q of (qs ?? []) as QuestionRow[]) qMap.set(q.id, q);

    // 답변에 질문 메타 inline
    const enriched = answers
      .map((a) => {
        const q = qMap.get(a.question_id);
        return {
          question_id: a.question_id,
          type: q?.type ?? 'unknown',
          axis: q?.axis ?? null,
          sort_order: q?.sort_order ?? 9999,
          title: {
            ru: q?.title_ru ?? a.question_id,
            en: q?.title_en ?? null,
            ko: q?.title_ko ?? null,
          },
          options: q?.options ?? null,
          answer: a.answer,
          translations: a.translations,
          translation_status: a.translation_status,
          translation_model: a.translation_model,
          translation_at: a.translation_at,
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order);

    log.info('response detail fetched', { response_id: id, answers: enriched.length });
    return jsonResponse(200, { response, answers: enriched }, log.requestId);
  } catch (err) {
    log.error('voice-response-detail failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
