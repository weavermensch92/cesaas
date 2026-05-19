/**
 * POST /studio-deploy — 검토 완료된 spec을 surveys + survey_questions로 배포.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 *
 * Body:
 *   {
 *     "spec": {...},                  // SurveySpec (위버가 편집한 최종)
 *     "target": "dealer" | "visitor",
 *     "draft_id"?: uuid,              // 있으면 draft를 'deployed'로 마킹
 *     "archive_previous"?: boolean    // 기본 true
 *   }
 *
 * 응답: { survey_id, deployed_at }
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/studio-deploy';

interface DeployBody {
  spec: Record<string, unknown>;
  target: 'dealer' | 'visitor';
  draft_id?: string;
  archive_previous?: boolean;
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

    const { data, error } = await db().rpc('deploy_survey', {
      p_target: body.target,
      p_spec: body.spec,
      p_actor: admin.email,
      p_archive_previous: body.archive_previous ?? true,
      p_draft_id: body.draft_id ?? null,
    });
    if (error) {
      if (error.code === '22023') {
        throw new ApiError('validation_failed', error.message);
      }
      throw new ApiError('internal_error', 'deploy_survey failed', { db: error.message });
    }

    log.info('survey deployed', {
      survey_id: data, target: body.target, draft_id: body.draft_id, actor: admin.email,
    });
    return jsonResponse(200, {
      survey_id: data,
      target: body.target,
      deployed_at: new Date().toISOString(),
    }, log.requestId);
  } catch (err) {
    log.error('studio-deploy failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseBody(req: Request): Promise<DeployBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'body must be JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;
  const spec = o.spec;
  if (!spec || typeof spec !== 'object') throw new ApiError('validation_failed', 'spec required (object)');
  const target = o.target === 'visitor' ? 'visitor' : 'dealer';
  return {
    spec: spec as Record<string, unknown>,
    target,
    ...(typeof o.draft_id === 'string' ? { draft_id: o.draft_id } : {}),
    ...(typeof o.archive_previous === 'boolean' ? { archive_previous: o.archive_previous } : {}),
  };
}
