// POST /responses-receive — handler 본체 (T_07.01 Phase C.1).
// Supabase Edge Function의 index.ts와 Fly.io Edge fallback(fly_edge/)이 동일 핸들러를 호출.
// 인증·검증·idempotency·segment 재계산·save_response·scoring 흐름은 동일.

import { resolveRespondent } from 'shared/bearer.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { sha256Hex } from 'shared/hash.ts';
import { lookupIdempotency, recordIdempotency } from 'shared/idempotency.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { classifyServerSide, type AxisData } from 'shared/segments.ts';
import { scoreLead } from 'shared/lead_scoring.ts';

export const ROUTE = '/responses-receive';

interface AnswerLine { question_id: string; answer: unknown }

export interface ResponsePayload {
  survey_id: string;
  respondent_type: 'dealer' | 'visitor';
  dealer_id?: string | null;
  event?: string | null;
  language?: string;
  nps?: number | null;
  future_subscription?: boolean | null;
  consent_data_collection?: boolean | null;
  segment?: string | null;
  segment_method?: string | null;
  segment_confidence?: number | null;
  axis_data?: AxisData | null;
  captured_at: string;
  answers: AnswerLine[];
  // Visitor 옵트인 연락처 (V_20.04) · Dealer 상담 대상 연락처
  contact_opted_in?: boolean;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  notes?: string | null;
  // Dealer 상담 대상 회사 (016) — dealer 응답은 필수
  target_company?: string | null;
}

export async function handle(req: Request): Promise<Response> {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');

    const bodyText = await req.text();
    const requestHash = await sha256Hex(bodyText);

    // 1) 인증
    const identity = await resolveRespondent(req);

    // 2) Idempotency
    const idemKey = req.headers.get('idempotency-key');
    if (idemKey) {
      const hit = await lookupIdempotency({ key: idemKey, route: ROUTE, requestHash });
      if (hit.hit) {
        log.info('idempotency hit', { key: idemKey });
        return jsonResponse(hit.status, hit.body, log.requestId);
      }
    }

    // 3) payload 검증
    const payload = parseAndValidate(bodyText, identity);

    // 4) 서버측 segment 재계산
    let segment      = payload.segment ?? null;
    let segmentMethod = payload.segment_method ?? null;
    let segmentConf  = payload.segment_confidence ?? null;
    if (payload.axis_data) {
      const serverSide = await classifyServerSide(payload.axis_data);
      if (!segment) {
        segment = serverSide.segment;
        segmentMethod = serverSide.method;
        segmentConf = serverSide.confidence;
      } else if (segment !== serverSide.segment) {
        log.warn('segment mismatch — server overrides', {
          client: segment, server: serverSide.segment, method: serverSide.method,
        });
        segment = serverSide.segment;
        segmentMethod = serverSide.method;
        segmentConf = Math.min(serverSide.confidence, 0.8);
      } else {
        segmentConf = Math.max(segmentConf ?? 0, serverSide.confidence);
      }
    }

    // 5) Visitor 24h quota
    if (identity.role === 'visitor') {
      const { data: remaining, error: quotaErr } = await db().rpc('visitor_quota_remaining', {
        p_device_id: identity.device_id,
        p_per_day: 5,
      });
      if (quotaErr) {
        log.warn('quota rpc failed (continue)', { db: quotaErr.message });
      } else if (typeof remaining === 'number' && remaining <= 0) {
        throw new ApiError('rate_limited', 'visitor quota exceeded (24h)', {
          device_id: identity.device_id,
        });
      }
    }

    // 6) save_response RPC
    const { data, error } = await db().rpc('save_response', {
      p_survey_id: payload.survey_id,
      p_respondent_type: payload.respondent_type,
      p_dealer_id: payload.respondent_type === 'dealer'
        ? (identity.role === 'dealer' ? identity.sub : null)
        : null,
      p_device_id: payload.respondent_type === 'visitor'
        ? (identity.role === 'visitor' ? identity.device_id : null)
        : null,
      p_event: payload.event ?? (identity.role === 'dealer' ? identity.event : null),
      p_language: payload.language ?? 'ru',
      p_nps: payload.nps ?? null,
      p_future_subscription: payload.future_subscription ?? null,
      p_consent: payload.consent_data_collection ?? null,
      p_segment: segment,
      p_segment_method: segmentMethod,
      p_segment_conf: segmentConf,
      p_axis_data: payload.axis_data ?? null,
      p_answers: payload.answers,
      p_captured_at: payload.captured_at,
      p_contact_name:     payload.respondent_type === 'dealer'
                            ? (payload.contact_name ?? null)
                            : (payload.contact_opted_in ? (payload.contact_name ?? null) : null),
      p_contact_phone:    payload.respondent_type === 'dealer'
                            ? (payload.contact_phone ?? null)
                            : (payload.contact_opted_in ? (payload.contact_phone ?? null) : null),
      p_contact_email:    payload.respondent_type === 'dealer'
                            ? (payload.contact_email ?? null)
                            : (payload.contact_opted_in ? (payload.contact_email ?? null) : null),
      p_notes:            payload.respondent_type === 'dealer'
                            ? (payload.notes ?? null)
                            : (payload.contact_opted_in ? (payload.notes ?? null) : null),
      p_contact_opted_in: payload.contact_opted_in ?? false,
      p_target_company:   payload.target_company ?? null,
    });
    if (error) {
      if (error.code === '23503') {
        throw new ApiError('validation_failed', 'unknown survey or question', { db: error.message });
      }
      throw new ApiError('internal_error', 'save_response failed', { db: error.message });
    }

    // Phase D.3 — Edge에서 lib 기반 scoring (trigger의 PERFORM 제거 후)
    // Phase F.4 — lead_id를 응답 body에 포함 (Dealer가 dealer-playbook 호출 위해 필요).
    let leadId: string | null = null;
    try {
      const { data: leadIdRow } = await db()
        .from('responses')
        .select('lead_id')
        .eq('id', data)
        .maybeSingle();
      leadId = (leadIdRow?.lead_id as string | null | undefined) ?? null;
      if (leadId) {
        const result = await scoreLead(leadId);
        if (!result.ok) {
          log.warn('scoreLead failed (non-fatal)', { lead_id: leadId, reason: result.reason });
        }
      }
    } catch (e) {
      log.warn('scoreLead path failed (non-fatal)', { reason: e instanceof Error ? e.message : String(e) });
    }

    const body = {
      id: data,
      lead_id: leadId,
      survey_id: payload.survey_id,
      segment,
      segment_method: segmentMethod,
      segment_confidence: segmentConf,
      received_at: new Date().toISOString(),
    };
    if (idemKey) {
      await recordIdempotency({ key: idemKey, route: ROUTE, requestHash, status: 200, body });
    }

    log.info('response saved', {
      id: data, lead_id: leadId, survey: payload.survey_id, segment,
      dealer_id: identity.role === 'dealer' ? identity.sub : null,
      device_id: identity.role === 'visitor' ? identity.device_id : null,
    });

    return jsonResponse(200, body, log.requestId);
  } catch (err) {
    log.error('responses-receive failed', err);
    return toJsonResponse(err, log.requestId);
  }
}

function parseAndValidate(text: string, identity: { role: string }): ResponsePayload {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ApiError('bad_request', 'body is not JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const o = raw as Record<string, unknown>;

  const surveyId = String(o.survey_id ?? '');
  const respondentType = o.respondent_type === 'visitor' ? 'visitor' : 'dealer';
  const capturedAt = String(o.captured_at ?? '');
  if (!surveyId) throw new ApiError('validation_failed', 'survey_id required');
  if (!capturedAt) throw new ApiError('validation_failed', 'captured_at required');

  if (respondentType === 'dealer' && identity.role !== 'dealer') {
    throw new ApiError('forbidden', 'dealer payload requires Bearer auth');
  }
  if (respondentType === 'visitor' && identity.role !== 'visitor') {
    throw new ApiError('forbidden', 'visitor payload requires X-Device-ID');
  }

  const rawAnswers = o.answers;
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    throw new ApiError('validation_failed', 'answers array required');
  }
  const answers: AnswerLine[] = rawAnswers.map((row, idx) => {
    if (!row || typeof row !== 'object') {
      throw new ApiError('validation_failed', `answers[${idx}] must be object`);
    }
    const qid = (row as Record<string, unknown>).question_id;
    if (typeof qid !== 'string' || !qid) {
      throw new ApiError('validation_failed', `answers[${idx}].question_id required`);
    }
    return { question_id: qid, answer: (row as Record<string, unknown>).answer ?? null };
  });

  const npsRaw = o.nps;
  let nps: number | null = null;
  if (npsRaw != null) {
    const n = Number(npsRaw);
    if (!Number.isInteger(n) || n < 0 || n > 10) {
      throw new ApiError('validation_failed', 'nps must be 0~10');
    }
    nps = n;
  }

  const optedIn = typeof o.contact_opted_in === 'boolean' ? o.contact_opted_in : false;
  const trimStr = (v: unknown, max = 500): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' ? null : t.slice(0, max);
  };

  const targetCompany = trimStr(o.target_company, 200);
  if (respondentType === 'dealer' && !targetCompany) {
    throw new ApiError('validation_failed', 'target_company required for dealer responses');
  }

  const saveContact = respondentType === 'dealer' || optedIn;

  return {
    survey_id: surveyId,
    respondent_type: respondentType,
    dealer_id: typeof o.dealer_id === 'string' ? o.dealer_id : null,
    event: typeof o.event === 'string' ? o.event : null,
    language: typeof o.language === 'string' ? o.language : 'ru',
    nps,
    future_subscription: typeof o.future_subscription === 'boolean' ? o.future_subscription : null,
    consent_data_collection: typeof o.consent_data_collection === 'boolean' ? o.consent_data_collection : null,
    segment: typeof o.segment === 'string' ? o.segment : null,
    segment_method: typeof o.segment_method === 'string' ? o.segment_method : null,
    segment_confidence: typeof o.segment_confidence === 'number' ? o.segment_confidence : null,
    axis_data: (o.axis_data && typeof o.axis_data === 'object') ? (o.axis_data as AxisData) : null,
    captured_at: capturedAt,
    answers,
    contact_opted_in: optedIn,
    contact_name:  saveContact ? trimStr(o.contact_name)  : null,
    contact_phone: saveContact ? trimStr(o.contact_phone) : null,
    contact_email: saveContact ? trimStr(o.contact_email) : null,
    notes:         saveContact ? trimStr(o.notes)         : null,
    target_company: targetCompany,
  };
}
