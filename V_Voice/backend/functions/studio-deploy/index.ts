/**
 * POST /studio-deploy — 검토 완료된 spec(들)을 surveys + survey_questions로 배포.
 *
 * serves: ['gridge_admin']
 * direction: 'downward'
 * harness: 1
 *
 * Body (v2 — 다중 target):
 *   {
 *     "brief_group_id"?: uuid,
 *     "archive_previous"?: boolean,           // 기본 true
 *     "deployments": [
 *       { "target_audience": "dealer", "spec": {...}, "draft_id"?: uuid, "version_label"?: "1.4" },
 *       { "target_audience": "visitor", "spec": {...}, "draft_id"?: uuid }
 *     ]
 *   }
 *
 * Body (레거시 호환):
 *   {
 *     "spec": {...}, "target": "dealer"|"visitor", "draft_id"?: uuid, "archive_previous"?: bool
 *   }
 *   → deployments 1건으로 변환.
 *
 * 응답:
 *   200 OK (전체 성공):
 *     { brief_group_id, deployments: [{ target_audience, survey_id, version_label, deployed_at }] }
 *   207 Multi-Status (부분 실패):
 *     { brief_group_id, deployments: [...success], errors: [{ target_audience, code, message }] }
 *   422/500 (전체 실패): 표준 에러 포맷.
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import type { TargetAudience } from 'shared/studio_lint.ts';

const ROUTE = '/studio-deploy';
const TARGETS: ReadonlyArray<TargetAudience> = ['dealer', 'visitor'];

interface DeployItem {
  target_audience: TargetAudience;
  spec: Record<string, unknown>;
  draft_id?: string;
  version_label?: string;
}

interface DeployBody {
  deployments: DeployItem[];
  brief_group_id?: string;
  archive_previous: boolean;
}

interface DeployResult {
  target_audience: TargetAudience;
  survey_id?: string;
  version_label?: string;
  deployed_at?: string;
  error?: { code: string; message: string };
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

    // target별 순차 배포 (트랜잭션은 deploy_survey RPC 내부)
    const results: DeployResult[] = [];
    for (const d of body.deployments) {
      results.push(await deployOne(d, body, admin.email, log));
    }

    const successes = results.filter((r) => !r.error);
    const errors = results.filter((r) => r.error);

    if (successes.length === 0) {
      // 전체 실패 — 첫 에러 코드로 변환
      const first = errors[0];
      const code = first?.error?.code === 'validation_failed' ? 'validation_failed' : 'internal_error';
      throw new ApiError(code as 'validation_failed' | 'internal_error',
        first?.error?.message ?? 'all deployments failed',
        { errors });
    }

    log.info('studio deploy complete', {
      brief_group_id: body.brief_group_id,
      ok_count: successes.length,
      err_count: errors.length,
      actor: admin.email,
    });

    const responseBody: Record<string, unknown> = {
      ...(body.brief_group_id ? { brief_group_id: body.brief_group_id } : {}),
      deployments: successes.map((r) => ({
        target_audience: r.target_audience,
        survey_id: r.survey_id,
        version_label: r.version_label,
        deployed_at: r.deployed_at,
      })),
    };
    if (errors.length > 0) {
      responseBody.errors = errors.map((r) => ({
        target_audience: r.target_audience,
        code: r.error?.code,
        message: r.error?.message,
      }));
      return jsonResponse(207, responseBody, log.requestId);
    }
    return jsonResponse(200, responseBody, log.requestId);
  } catch (err) {
    log.error('studio-deploy failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

// ─── 1 target 배포 ─────────────────────────────────────────────────────────

async function deployOne(
  item: DeployItem,
  body: DeployBody,
  actor: string,
  log: ReturnType<typeof requestLogger>,
): Promise<DeployResult> {
  try {
    const { data, error } = await db().rpc('deploy_survey', {
      p_target: item.target_audience,
      p_spec: item.spec,
      p_actor: actor,
      p_archive_previous: body.archive_previous,
      p_draft_id: item.draft_id ?? null,
      p_version_label: item.version_label ?? null,
      p_brief_group_id: body.brief_group_id ?? null,
    });
    if (error) {
      const code = error.code === '22023' ? 'validation_failed' : 'internal_error';
      return {
        target_audience: item.target_audience,
        error: { code, message: error.message },
      };
    }

    // version_label 확인용 SELECT (RPC 반환은 survey_id만이므로 별도 조회)
    const surveyId = data as string;
    const { data: row } = await db()
      .from('surveys')
      .select('version_label')
      .eq('id', surveyId)
      .single();

    log.info('survey deployed', {
      target: item.target_audience,
      survey_id: surveyId,
      version_label: row?.version_label,
      draft_id: item.draft_id,
    });
    return {
      target_audience: item.target_audience,
      survey_id: surveyId,
      version_label: row?.version_label ?? undefined,
      deployed_at: new Date().toISOString(),
    };
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'internal_error';
    const message = err instanceof Error ? err.message : 'unknown';
    log.error('deployOne failed', { target: item.target_audience, code, message });
    return {
      target_audience: item.target_audience,
      error: { code, message },
    };
  }
}

// ─── 입력 파싱 (v2 + 레거시 호환) ───────────────────────────────────────────

async function parseBody(req: Request): Promise<DeployBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'body must be JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;

  const archive_previous = typeof o.archive_previous === 'boolean' ? o.archive_previous : true;
  const brief_group_id = typeof o.brief_group_id === 'string' && o.brief_group_id
    ? o.brief_group_id : undefined;

  // v2: deployments 배열
  if (Array.isArray(o.deployments) && o.deployments.length > 0) {
    const deployments = o.deployments.map((d, idx) => parseDeployItem(d, idx));
    if (deployments.length > 2) {
      throw new ApiError('validation_failed', 'deployments max 2 (dealer + visitor)');
    }
    return {
      deployments,
      archive_previous,
      ...(brief_group_id ? { brief_group_id } : {}),
    };
  }

  // 레거시: { spec, target, draft_id }
  if (o.spec && typeof o.spec === 'object'
      && typeof o.target === 'string' && TARGETS.includes(o.target as TargetAudience)) {
    const item: DeployItem = {
      target_audience: o.target as TargetAudience,
      spec: o.spec as Record<string, unknown>,
      ...(typeof o.draft_id === 'string' ? { draft_id: o.draft_id } : {}),
    };
    return { deployments: [item], archive_previous };
  }

  throw new ApiError('validation_failed',
    'deployments[] required (or legacy { spec, target })');
}

function parseDeployItem(raw: unknown, idx: number): DeployItem {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('validation_failed', `deployments[${idx}] must be object`);
  }
  const o = raw as Record<string, unknown>;
  if (!TARGETS.includes(o.target_audience as TargetAudience)) {
    throw new ApiError('validation_failed', `deployments[${idx}].target_audience invalid`);
  }
  if (!o.spec || typeof o.spec !== 'object') {
    throw new ApiError('validation_failed', `deployments[${idx}].spec required`);
  }
  return {
    target_audience: o.target_audience as TargetAudience,
    spec: o.spec as Record<string, unknown>,
    ...(typeof o.draft_id === 'string' ? { draft_id: o.draft_id } : {}),
    ...(typeof o.version_label === 'string' && o.version_label
        ? { version_label: o.version_label } : {}),
  };
}
