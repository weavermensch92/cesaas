/**
 * POST /admin-lead-associate — unassociated Lead에 entity_id 수동 연결 (U-004).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 * related_hypothesis: ['H_채널통합']
 *
 * 흐름:
 *   1. Admin 인증
 *   2. body: { lead_id, entity_id, crm_id (기본 'bitrix24') }
 *   3. lead 조회 — 존재 + entity_id IS NULL 확인
 *   4. UPDATE leads SET entity_id = X, crm_id = Y
 *      → UNIQUE(entity_id, crm_id) 충돌 시 (23505):
 *         같은 entity_id를 가진 기존 lead 조회 → 409 conflict + target_id 반환
 *         (실제 merge는 별도 admin-lead-merge — Phase 2)
 *   5. 200 + 갱신된 lead 요약
 *
 * 향후:
 *   - merge action (responses·captures·lead_links 이전 후 src lead status='merged')
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/admin-lead-associate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AssociateBody {
  lead_id?: string;
  entity_id?: string;
  crm_id?: string;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);

    const raw = await req.text();
    let body: AssociateBody;
    try { body = JSON.parse(raw); } catch { throw new ApiError('bad_request', 'body is not JSON'); }

    const leadId = String(body.lead_id ?? '').trim();
    const entityId = String(body.entity_id ?? '').trim();
    const crmId = String(body.crm_id ?? 'bitrix24').trim();

    if (!leadId || !UUID_RE.test(leadId)) {
      throw new ApiError('validation_failed', 'lead_id (uuid) required');
    }
    if (!entityId || entityId.length < 2 || entityId.length > 100) {
      throw new ApiError('validation_failed', 'entity_id required (2~100 chars)');
    }
    if (!crmId || crmId.length > 50) {
      throw new ApiError('validation_failed', 'crm_id required (<=50 chars)');
    }

    // 1) 현재 lead 조회
    const { data: lead, error: leadErr } = await db()
      .from('leads')
      .select('id, entity_id, crm_id, company_name, status')
      .eq('id', leadId)
      .maybeSingle();
    if (leadErr) throw new ApiError('internal_error', 'lead fetch failed', { db: leadErr.message });
    if (!lead) throw new ApiError('not_found', 'lead not found', { lead_id: leadId });
    if (lead.status !== 'active') {
      throw new ApiError('conflict', `lead status=${lead.status}; only active leads can be associated`);
    }
    if (lead.entity_id) {
      throw new ApiError('conflict', 'lead already associated', {
        current_entity_id: lead.entity_id,
        current_crm_id: lead.crm_id,
      });
    }

    // 2) UPDATE — UNIQUE(entity_id, crm_id) 충돌 시 23505
    const { data: updated, error: updErr } = await db()
      .from('leads')
      .update({ entity_id: entityId, crm_id: crmId })
      .eq('id', leadId)
      .select('id, entity_id, crm_id, company_name, segment, priority, score, grade')
      .maybeSingle();

    if (updErr) {
      if (updErr.code === '23505') {
        // 기존 점유 lead 조회해서 alternate 제공
        const { data: target } = await db()
          .from('leads')
          .select('id, company_name, score, priority, segment')
          .eq('entity_id', entityId)
          .eq('crm_id', crmId)
          .maybeSingle();
        throw new ApiError('conflict', 'entity_id already used by another lead', {
          entity_id: entityId, crm_id: crmId,
          target_lead_id: target?.id ?? null,
          target_company: target?.company_name ?? null,
          hint: 'merge — admin-lead-merge (Phase 2, 현재 미구현). 임시: 본 lead의 응답을 target lead로 수동 이전 또는 본 lead archive',
        });
      }
      throw new ApiError('internal_error', 'UPDATE failed', { db: updErr.message });
    }

    log.info('lead associated', {
      lead_id: leadId, entity_id: entityId, crm_id: crmId, actor: admin.email,
    });

    return jsonResponse(200, {
      lead: updated,
      actor: admin.email,
    }, log.requestId);
  } catch (err) {
    log.error('admin-lead-associate failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
