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
import { loadRule } from 'shared/rules.ts';
import { computeHeatmap, extractAxisDataV2 } from 'shared/heatmap_mapping.ts';
import {
  computeDw,
  DW_AXES,
  type DWAxis,
  type DWExtraction,
  type DWInput,
  type WeightMatrix,
} from '@hd/core/decision_weight';

const CTT_DEALER_SURVEY_ID = 'survey_v2_dealer_ctt';
const V1_DEALER_2026REV_SURVEY_ID = 'survey_v1_dealer_2026rev';

// 042 usage_hier value(level 1) → R_10.05 v2 work_env value 매핑.
// 대분류 prefix(1.x/2.x/3.x/4.x)로 결정 — level 1 세부값은 R_10.05 v2 segment로 통합 정규화.
//   1.x (건설 현장 전반) → infrastructure (대형 건설)
//   2.x (광물 채굴) → mining
//   3.x (건축 자재 생산) → infrastructure (건설 인프라 인접)
//   4.x (부품·소모품·서비스) → fleet_rental (부품·서비스 사업 proxy)
function usageHierToWorkEnv(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('1')) return 'infrastructure';
  if (value.startsWith('2')) return 'mining';
  if (value.startsWith('3')) return 'infrastructure';
  if (value.startsWith('4')) return 'fleet_rental';
  return null;
}

// 042 답변 배열에서 axisData v1.2026rev 합성 — usage_hier·DW 6축·기타 신호.
function extractAxisDataV1_2026rev(answers: Array<{ question_id: string; answer: unknown }>): AxisData {
  const find = (qid: string): unknown => answers.find((a) => a.question_id === qid)?.answer;
  const usageRaw = find('q_v1d26_usage_hier');
  let usageValue: string | null = null;
  if (typeof usageRaw === 'string') usageValue = usageRaw;
  else if (usageRaw && typeof usageRaw === 'object' && 'choice' in (usageRaw as Record<string, unknown>)) {
    const c = (usageRaw as { choice?: unknown }).choice;
    usageValue = typeof c === 'string' ? c : null;
  }
  const workEnv = usageHierToWorkEnv(usageValue);
  const fleetMap: Record<string, string> = { '0': 'S', '1_10': 'S', '10_50': 'M', '50_100': 'L', 'gt_100': 'XL' };
  const fleet = typeof find('q_v1d26_fleet5') === 'string'
    ? fleetMap[find('q_v1d26_fleet5') as string] ?? null
    : null;
  return {
    work_env: workEnv,
    fleet_size: fleet,
  };
}

// 042 DW 6축 unique 점수 검증 — 6 axis의 점수가 서로 달라야 함 (한 점수가 한 axis에만).
const V1_2026REV_DW_QIDS = [
  'q_v1d26_dw_price', 'q_v1d26_dw_fuel', 'q_v1d26_dw_durability',
  'q_v1d26_dw_service', 'q_v1d26_dw_reference', 'q_v1d26_dw_versatility',
];
function validateUniqueScores(answers: Array<{ question_id: string; answer: unknown }>): void {
  const used = new Map<number, string>();
  for (const a of answers) {
    if (!V1_2026REV_DW_QIDS.includes(a.question_id)) continue;
    const v = typeof a.answer === 'number' ? a.answer : null;
    if (v === null) continue;
    if (used.has(v)) {
      throw new ApiError('validation_failed',
        `점수 ${v}은(는) 이미 ${used.get(v)} axis에 부여됨. 6 axis는 서로 다른 점수를 받습니다.`,
        { duplicate_score: v, used_by: used.get(v), conflict: a.question_id });
    }
    used.set(v, a.question_id);
  }
}

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
  // Dealer v2 (025) — 6 가치축 점수 + 가설 segment
  preference_axes?: Record<string, number> | null;
  dealer_hypothesis_segment?: string | null;
  // R_10.10 (031) — 간접 추론 모드. preference_axes 미동봉 시 서버가 산출.
  dw_raw_answers?: DWInput | null;
  // V-026 — visitor bot 방지 (옵션). HCAPTCHA_SECRET env 설정 시 backend가 검증.
  hcaptcha_token?: string | null;
}

// V-026 — hCaptcha siteverify. HCAPTCHA_SECRET 미설정 시 OFF (honeypot만).
// visitor + 토큰 있을 때만 fire. dealer는 Bearer JWT 이미 검증되므로 skip.
async function verifyHCaptcha(token: string | null | undefined): Promise<{ ok: boolean; reason?: string }> {
  const secret = Deno.env.get('HCAPTCHA_SECRET');
  if (!secret) return { ok: true };                  // OFF
  if (!token) return { ok: false, reason: 'token_missing' };
  try {
    const params = new URLSearchParams({ secret, response: token });
    const res = await fetch('https://api.hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) return { ok: false, reason: `siteverify_http_${res.status}` };
    const data = await res.json() as { success?: boolean; 'error-codes'?: string[] };
    if (data.success === true) return { ok: true };
    return { ok: false, reason: (data['error-codes'] ?? ['siteverify_fail']).join(',') };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'siteverify_throw' };
  }
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

    // 3.5) V-026 hCaptcha — visitor만. HCAPTCHA_SECRET 미설정이면 OFF.
    if (payload.respondent_type === 'visitor') {
      const captcha = await verifyHCaptcha(payload.hcaptcha_token);
      if (!captcha.ok) {
        log.warn('hCaptcha failed', { reason: captcha.reason });
        throw new ApiError('validation_failed', 'hCaptcha verification failed', {
          hcaptcha_reason: captcha.reason,
        });
      }
    }

    // 4) survey_v2_dealer_ctt / survey_v1_dealer_2026rev — 서버가 axis_data 합성.
    //    클라이언트가 axis_data를 보냈으면 그 값과 merge (서버 합성이 base, 클라 값이 override).
    let axisData: AxisData | null = payload.axis_data;
    if (payload.survey_id === CTT_DEALER_SURVEY_ID) {
      const synthesized = extractAxisDataV2(payload.answers, payload.survey_id);
      axisData = { ...synthesized, ...(payload.axis_data ?? {}) };
    } else if (payload.survey_id === V1_DEALER_2026REV_SURVEY_ID) {
      // DW 6축 unique 점수 사전 검증 — 같은 점수가 두 axis에 부여되면 거부.
      validateUniqueScores(payload.answers);
      const synthesized = extractAxisDataV1_2026rev(payload.answers);
      axisData = { ...synthesized, ...(payload.axis_data ?? {}) };
    }

    // 4.1) 서버측 segment 재계산
    let segment      = payload.segment ?? null;
    let segmentMethod = payload.segment_method ?? null;
    let segmentConf  = payload.segment_confidence ?? null;
    if (axisData) {
      const serverSide = await classifyServerSide(axisData);
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

    // 4.2) survey_v2_dealer_ctt — 8 segment × 6 axis 히트맵 산출 → axis_data.heatmap_scores 첨부.
    //      preference_axes는 클라 값 우선, 없으면 heatmap_scores 0~100 → 1~5 정규화.
    if (payload.survey_id === CTT_DEALER_SURVEY_ID && axisData && segment) {
      try {
        const heatmap = await computeHeatmap(segment, axisData);
        axisData = { ...axisData, heatmap_scores: heatmap.scores };
        if (!payload.preference_axes) {
          const synthesizedAxes = {} as Record<DWAxis, number>;
          for (const axis of DW_AXES) {
            const s = heatmap.scores[axis];
            synthesizedAxes[axis] = Math.max(1, Math.min(5, Math.round(s / 20) + 1));
          }
          payload.preference_axes = synthesizedAxes;
        }
      } catch (e) {
        log.warn('heatmap synth failed — proceed without heatmap_scores', {
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 4.5) R_10.10 DW 간접 추론 — preference_axes 미동봉 + dw_raw_answers 있을 때만 산출
    let preferenceAxes: Record<string, number> | null = payload.preference_axes ?? null;
    let dwExtraction: DWExtraction | null = null;
    if (!preferenceAxes && payload.dw_raw_answers) {
      try {
        const r1010 = await loadRule<{ weight_matrix?: WeightMatrix }>('R_10.10_DecisionWeight');
        const matrix = r1010.body?.weight_matrix;
        if (!matrix) {
          log.warn('R_10.10 loaded but weight_matrix missing — skip DW inference');
        } else {
          const result = computeDw(payload.dw_raw_answers, matrix, { ruleVersion: r1010.version });
          preferenceAxes = result.preference_axes;
          dwExtraction = result.dw_extraction;
        }
      } catch (e) {
        // 룰 로드 실패해도 응답 저장은 계속 — preference_axes/dw_extraction 둘 다 NULL.
        log.warn('R_10.10 load failed — DW inference skipped', {
          reason: e instanceof Error ? e.message : String(e),
        });
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
      p_axis_data: axisData ?? null,
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
      p_preference_axes:  preferenceAxes,
      p_dealer_hypothesis_segment: payload.dealer_hypothesis_segment ?? null,
      p_dw_raw_answers:   payload.dw_raw_answers ?? null,
      p_dw_extraction:    dwExtraction,
    });
    if (error) {
      if (error.code === '23503') {
        throw new ApiError('validation_failed', 'unknown survey or question', { db: error.message });
      }
      throw new ApiError('internal_error', 'save_response failed', { db: error.message });
    }

    // 7) 자유 텍스트 응답을 번역 큐로 enqueue (043 RPC) — best-effort, 실패해도 응답 저장 OK.
    //    type=text_short/text_long 또는 answer가 {choice, other_text} 구조에서 other_text가 비어있지 않은 경우.
    void enqueueTranslations(data as string, payload, log);

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
    preference_axes: (o.preference_axes && typeof o.preference_axes === 'object' && !Array.isArray(o.preference_axes))
      ? (o.preference_axes as Record<string, number>)
      : null,
    dealer_hypothesis_segment: trimStr(o.dealer_hypothesis_segment, 50),
    dw_raw_answers: parseDwRawAnswers(o.dw_raw_answers),
    hcaptcha_token: typeof o.hcaptcha_token === 'string' ? o.hcaptcha_token.slice(0, 4000) : null,
  };
}

// R_10.10 input_schema 기반 화이트리스트 파싱. 잘못된 보기는 무시(silent drop) — 룰 모드는 응답이 적으면
// missing_prior 0.5로 자연스럽게 처리되므로 throw 안 함.
function parseDwRawAnswers(raw: unknown): DWInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const single = (v: unknown, allowed: readonly string[]): string | null => {
    if (typeof v !== 'string') return null;
    return allowed.includes(v) ? v : null;
  };
  const multi = (v: unknown, allowed: readonly string[], maxLen: number): string[] | null => {
    if (!Array.isArray(v)) return null;
    const filtered = v.filter((x): x is string => typeof x === 'string' && allowed.includes(x));
    if (filtered.length === 0) return null;
    return filtered.slice(0, maxLen);
  };

  const q3 = single(o.q3_prime, ['A', 'B', 'C', 'D', 'E']);
  const q4 = multi(o.q4_prime, ['A', 'B', 'C', 'D'], 2);
  const q5 = single(o.q5_prime, ['A', 'B', 'C', 'D', 'E', 'F']);
  const q6 = single(o.q6_prime, ['A', 'B', 'C', 'D']);
  const q7 = multi(o.q7_prime, ['A', 'B', 'C', 'D'], 2);
  const q8raw = typeof o.q8_prime === 'string' ? o.q8_prime.trim() : '';
  const q8 = q8raw === '' ? null : q8raw.slice(0, 500);

  if (q3 == null && q4 == null && q5 == null && q6 == null && q7 == null && q8 == null) return null;

  return {
    q3_prime: q3 as DWInput['q3_prime'],
    q4_prime: q4 as DWInput['q4_prime'],
    q5_prime: q5 as DWInput['q5_prime'],
    q6_prime: q6 as DWInput['q6_prime'],
    q7_prime: q7 as DWInput['q7_prime'],
    q8_prime: q8,
  };
}

// 043 enqueue_response_translation — text_short/text_long 답변 + {choice, other_text} 구조의 other_text 식별.
// best-effort. log.warn으로 끝.
async function enqueueTranslations(
  responseId: string,
  payload: ResponsePayload,
  log: ReturnType<typeof requestLogger>,
): Promise<void> {
  try {
    const lang = payload.language ?? 'ru';
    // text_short / text_long 답변
    for (const a of payload.answers) {
      const text = extractFreeText(a.answer);
      if (text) {
        const { error } = await db().rpc('enqueue_response_translation', {
          p_response_id: responseId,
          p_question_id: a.question_id,
          p_answer_text: text,
          p_source_lang: lang,
        });
        if (error) log.warn('enqueue_translation failed', { qid: a.question_id, db: error.message });
      }
    }
  } catch (e) {
    log.warn('enqueueTranslations path failed (non-fatal)', { reason: e instanceof Error ? e.message : String(e) });
  }
}

// 자유 텍스트 추출:
//   - 문자열 그대로 (text_short/text_long 답변)
//   - {choice, other_text} 또는 {text} 구조에서 텍스트 필드
//   - 빈 문자열은 null 반환 (큐 skip)
function extractFreeText(answer: unknown): string | null {
  if (typeof answer === 'string') {
    const t = answer.trim();
    return t.length > 0 ? t : null;
  }
  if (answer && typeof answer === 'object') {
    const o = answer as Record<string, unknown>;
    const candidate = (typeof o.other_text === 'string' && o.other_text.trim().length > 0)
      ? o.other_text
      : (typeof o.text === 'string' && o.text.trim().length > 0 ? o.text : null);
    return candidate ? (candidate as string).trim() : null;
  }
  return null;
}
