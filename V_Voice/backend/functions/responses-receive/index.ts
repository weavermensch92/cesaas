/**
 * POST /responses-receive — Dealer/Visitor 응답 수신.
 *
 * serves: ['dealer', 'visitor']
 * direction: 'upward'
 * related_hypothesis: ['V_가설', 'H_채널통합']
 *
 * 인증:
 *   - Bearer (Dealer): VOICE_JWT_SECRET 으로 verify, role='dealer'
 *   - X-Device-ID  (Visitor): anonymous
 *
 * 처리:
 *   1. 인증 → respondent identity
 *   2. Idempotency-Key 룩업
 *   3. payload schema 검증 + required answers 검증
 *   4. 서버측 R_10.05 segment 재계산 (axis_data 있으면) — 클라이언트와 다르면 confidence 조정
 *   5. save_response RPC → responses + response_answers 트랜잭션
 *   6. Idempotency 기록 + 응답
 */

import { resolveRespondent } from 'shared/bearer.ts';
import { ApiError, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { sha256Hex } from 'shared/hash.ts';
import { lookupIdempotency, recordIdempotency } from 'shared/idempotency.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { classifyServerSide, type AxisData } from 'shared/segments.ts';

const ROUTE = '/responses-receive';

interface AnswerLine { question_id: string; answer: unknown }

interface ResponsePayload {
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
  // Visitor 옵트인 연락처 (V_20.04)
  contact_opted_in?: boolean;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  notes?: string | null;
}

Deno.serve(async (req: Request) => {
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
      const serverSide = classifyServerSide(payload.axis_data);
      if (!segment) {
        segment = serverSide.segment;
        segmentMethod = serverSide.method;
        segmentConf = serverSide.confidence;
      } else if (segment !== serverSide.segment) {
        // 클라이언트·서버 mismatch — 서버를 우선하지만 confidence 낮춤.
        log.warn('segment mismatch — server overrides', {
          client: segment, server: serverSide.segment,
        });
        segment = serverSide.segment;
        segmentMethod = 'server_rule';
        segmentConf = Math.min(serverSide.confidence, 0.8);
      } else {
        segmentConf = Math.max(segmentConf ?? 0, serverSide.confidence);
      }
    }

    // 5) Visitor 24h quota (009_voice_visitor.sql) — bot 방지·중복 차단
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

    // 6) save_response RPC (옵트인 연락처 포함)
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
      p_contact_name:     payload.contact_opted_in ? (payload.contact_name  ?? null) : null,
      p_contact_phone:    payload.contact_opted_in ? (payload.contact_phone ?? null) : null,
      p_contact_email:    payload.contact_opted_in ? (payload.contact_email ?? null) : null,
      p_notes:            payload.contact_opted_in ? (payload.notes         ?? null) : null,
      p_contact_opted_in: payload.contact_opted_in ?? false,
    });
    if (error) {
      if (error.code === '23503') {
        throw new ApiError('validation_failed', 'unknown survey or question', { db: error.message });
      }
      throw new ApiError('internal_error', 'save_response failed', { db: error.message });
    }

    const body = {
      id: data,
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
      id: data, survey: payload.survey_id, segment,
      dealer_id: identity.role === 'dealer' ? identity.sub : null,
      device_id: identity.role === 'visitor' ? identity.device_id : null,
    });
    return jsonResponse(200, body, log.requestId);
  } catch (err) {
    log.error('responses-receive failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

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

  // role / respondent_type 일치 확인
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

  // nps 범위
  const npsRaw = o.nps;
  let nps: number | null = null;
  if (npsRaw != null) {
    const n = Number(npsRaw);
    if (!Number.isInteger(n) || n < 0 || n > 10) {
      throw new ApiError('validation_failed', 'nps must be 0~10');
    }
    nps = n;
  }

  // 옵트인 연락처는 visitor 한정, opted_in=true일 때만 보존
  const optedIn = typeof o.contact_opted_in === 'boolean' ? o.contact_opted_in : false;
  const trimStr = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' ? null : t.slice(0, 500);
  };

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
    contact_name:  respondentType === 'visitor' && optedIn ? trimStr(o.contact_name)  : null,
    contact_phone: respondentType === 'visitor' && optedIn ? trimStr(o.contact_phone) : null,
    contact_email: respondentType === 'visitor' && optedIn ? trimStr(o.contact_email) : null,
    notes:         respondentType === 'visitor' && optedIn ? trimStr(o.notes)         : null,
  };
}
