/**
 * GET /dealer-consultations — 딜러 본인 상담 이력 (V_30.05).
 *
 * serves: ['dealer']
 * direction: 'downward'
 *
 * 인증: Bearer JWT (dealer). sub=dealer_id, jti revoke 차단은 verifyDealerBearer가 담당.
 * 응답: list_dealer_consultations(dealer_id, limit) RPC 결과.
 *   { data: [{id, captured_at, target_company, contact_name, contact_phone, segment, nps, notes}] }
 *
 * 쿼리:
 *   limit (1~200, 기본 50)
 *
 * 부스에서 같은 회사 중복 입력 방지, 어제·오늘 누구 만났는지 즉시 확인용.
 */

import { verifyDealerBearer } from 'shared/bearer.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { parseLimit } from 'shared/pagination.ts';

const ROUTE = '/dealer-consultations';

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    const identity = await verifyDealerBearer(req);

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get('limit'));

    const { data, error } = await db().rpc('list_dealer_consultations', {
      p_dealer_id: identity.sub,
      p_limit: limit,
    });
    if (error) {
      throw new ApiError('internal_error', 'list_dealer_consultations failed', { db: error.message });
    }

    return jsonResponse(200, {
      dealer_id: identity.sub,
      event: identity.event,
      data: data ?? [],
    }, log.requestId);
  } catch (err) {
    log.error('dealer-consultations failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
