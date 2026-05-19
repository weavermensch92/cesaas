/**
 * GET /dealer-playbook?lead_id=<uuid> — 딜러용 Playbook fetch (V-009 Phase F.3).
 *
 * serves: ['dealer']
 * direction: 'downward'
 * related_hypothesis: ['V_가설', 'H_채널통합']
 *
 * 인증: Bearer JWT (dealer). sub=dealer_id.
 * 권한: 해당 lead에 본인이 송출한 응답이 1건 이상 있어야 조회 가능 (소유권 검증).
 * 응답: 최신 active dealer_outputs row (title·weapons·pitch·models·next_action·priority·segment·score·rule_version).
 *
 * 흐름:
 *   1. Dealer JWT verify
 *   2. lead_id param 검증
 *   3. ownership 확인 — responses WHERE lead_id=X AND dealer_id=identity.sub
 *   4. dealer_outputs(active) lookup
 *   5. 반환
 *
 * Dealer 단말 사용:
 *   응답 송출 후 받은 lead_id로 이 endpoint 호출 → result 화면에 Playbook 즉시 표시.
 *   업데이트된 R_10.07이 5분 안에 반영됨 (publish-rule.ts hot reload 사이클의 종착).
 */

import { verifyDealerBearer } from 'shared/bearer.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/dealer-playbook';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    const identity = await verifyDealerBearer(req);

    const url = new URL(req.url);
    const leadId = url.searchParams.get('lead_id');
    if (!leadId || !UUID_RE.test(leadId)) {
      throw new ApiError('validation_failed', 'lead_id (uuid) required');
    }

    // 1) 소유권 — 본인이 송출한 응답이 이 lead에 있는지
    const { data: ownership, error: ownErr } = await db()
      .from('responses')
      .select('id')
      .eq('lead_id', leadId)
      .eq('dealer_id', identity.sub)
      .limit(1)
      .maybeSingle();
    if (ownErr) {
      throw new ApiError('internal_error', 'ownership check failed', { db: ownErr.message });
    }
    if (!ownership) {
      // 본인 응답이 없으면 forbidden — leakage 방지
      throw new ApiError('forbidden', 'lead not owned by this dealer');
    }

    // 2) active playbook
    const { data: output, error: outErr } = await db()
      .from('dealer_outputs')
      .select('id, segment, priority, score_snapshot, title, weapons, pitch, models, next_action, rule_version, created_at')
      .eq('lead_id', leadId)
      .eq('status', 'active')
      .maybeSingle();
    if (outErr) {
      throw new ApiError('internal_error', 'dealer_outputs fetch failed', { db: outErr.message });
    }
    if (!output) {
      // scoring이 아직 안 됐거나 segment 없는 응답
      return jsonResponse(200, {
        lead_id: leadId,
        playbook: null,
        reason: 'no_active_output',
      }, log.requestId);
    }

    return jsonResponse(200, {
      lead_id: leadId,
      dealer_id: identity.sub,
      playbook: {
        segment: output.segment,
        priority: output.priority,
        score: output.score_snapshot,
        title: output.title,
        weapons: output.weapons,
        pitch: output.pitch,
        models: output.models,
        next_action: output.next_action,
        rule_version: output.rule_version,
        issued_at: output.created_at,
      },
    }, log.requestId);
  } catch (err) {
    log.error('dealer-playbook failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
