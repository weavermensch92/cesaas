/**
 * GET /surveys-get?audience=dealer  → { survey, questions[] }
 *
 * serves: ['dealer', 'visitor']
 * direction: 'upward'
 *
 * 활성(status='active') 설문 1개 + 정렬된 질문 반환.
 * Studio publish 결과를 dealer/visitor surface 가 동적으로 fetch.
 *
 * 인증: 없음 (공개). 설문 내용은 비밀이 아님 — 어차피 응답자가 봄.
 */
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/surveys-get' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    const url = new URL(req.url);
    const audience = url.searchParams.get('audience');
    if (audience !== 'dealer' && audience !== 'visitor') {
      throw new ApiError('validation_failed', "audience must be 'dealer' or 'visitor'");
    }

    // 활성 survey 1건 (최신)
    const { data: surveys, error: sErr } = await db()
      .from('surveys')
      .select('id, title, description, target_audience, language_default, languages_available, estimated_minutes, status, created_at, updated_at')
      .eq('target_audience', audience)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (sErr) throw new ApiError('internal_error', 'survey query failed', { db: sErr.message });
    const survey = surveys?.[0];
    if (!survey) throw new ApiError('not_found', `no active survey for ${audience}`);

    // 질문
    const { data: questions, error: qErr } = await db()
      .from('survey_questions')
      .select('id, type, title_ru, title_en, title_ko, axis, options, required, sort_order')
      .eq('survey_id', survey.id)
      .order('sort_order', { ascending: true });
    if (qErr) throw new ApiError('internal_error', 'question query failed', { db: qErr.message });

    log.info('survey fetched', { survey_id: survey.id, count: questions?.length ?? 0 });
    return jsonResponse(200, { survey, questions: questions ?? [] }, log.requestId);
  } catch (err) {
    log.error('surveys-get failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
