/**
 * GET /studio-surveys-list — Studio 편집기의 "기존 질문지 수정" picker용 active 설문 목록.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * harness: 1
 *
 * Query (optional):
 *   target_audience=dealer|visitor   — 필터
 *   include_archived=true            — archived도 포함 (기본 active만)
 *
 * 응답:
 *   {
 *     "surveys": [{
 *       "id": "survey_v1_dealer_...",
 *       "title": "...",
 *       "target_audience": "dealer",
 *       "version_label": "1.4",
 *       "status": "active",
 *       "language_default": "ru",
 *       "estimated_minutes": 5,
 *       "question_count": 31,
 *       "created_at": "...",
 *       "updated_at": "..."
 *     }]
 *   }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/studio-surveys-list';
const TARGETS = ['dealer', 'visitor'] as const;

interface SurveyRow {
  id: string;
  title: string;
  target_audience: 'dealer' | 'visitor';
  version_label: string | null;
  status: string;
  language_default: string;
  estimated_minutes: number | null;
  created_at: string;
  updated_at: string;
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
    const target = url.searchParams.get('target_audience');
    const includeArchived = url.searchParams.get('include_archived') === 'true';

    let query = db()
      .from('surveys')
      .select('id, title, target_audience, version_label, status, language_default, estimated_minutes, created_at, updated_at')
      .order('target_audience', { ascending: true })
      .order('updated_at', { ascending: false });

    if (!includeArchived) {
      query = query.eq('status', 'active');
    }
    if (target && (TARGETS as ReadonlyArray<string>).includes(target)) {
      query = query.eq('target_audience', target);
    }

    const { data: surveys, error } = await query.returns<SurveyRow[]>();
    if (error) {
      throw new ApiError('internal_error', 'surveys SELECT failed', { db: error.message });
    }

    // 문항 수 일괄 조회 (per-survey count)
    const ids = (surveys ?? []).map((s) => s.id);
    const counts = await fetchQuestionCounts(ids);

    log.info('studio surveys list', {
      count: surveys?.length ?? 0,
      target_filter: target ?? 'all',
      include_archived: includeArchived,
    });

    return jsonResponse(200, {
      surveys: (surveys ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        target_audience: s.target_audience,
        ...(s.version_label ? { version_label: s.version_label } : {}),
        status: s.status,
        language_default: s.language_default,
        ...(s.estimated_minutes !== null ? { estimated_minutes: s.estimated_minutes } : {}),
        question_count: counts.get(s.id) ?? 0,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    }, log.requestId);
  } catch (err) {
    log.error('studio-surveys-list failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function fetchQuestionCounts(surveyIds: string[]): Promise<Map<string, number>> {
  if (surveyIds.length === 0) return new Map();
  const { data, error } = await db()
    .from('survey_questions')
    .select('survey_id')
    .in('survey_id', surveyIds)
    .returns<{ survey_id: string }[]>();
  if (error || !data) return new Map();
  const map = new Map<string, number>();
  for (const row of data) {
    map.set(row.survey_id, (map.get(row.survey_id) ?? 0) + 1);
  }
  return map;
}
