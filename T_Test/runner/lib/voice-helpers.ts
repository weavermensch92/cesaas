// Voice 응답 송출 helpers — Dealer Bearer or Visitor Anonymous.
// T_05·T_06에서 공유.

import { http } from './http.js';
import {
  DEALER_FIXTURE_MINING,
  VISITOR_FIXTURE_CONSTRUCTION,
  expectedSegment,
  makeDealerAnswers,
  makeVisitorAnswers,
  type VoiceAxis,
} from './fixtures.js';
import { signDealerToken } from './jwt.js';
import { randomUUID } from 'node:crypto';

export interface VoicePostResult {
  status: number;
  responseId: string | null;
  serverSegment: string | null;
  durationMs: number;
  bodyJson: unknown;
}

/**
 * Dealer 응답 송출 — 새 JWT + survey_v1_dealer answers.
 * axis 안에 entity_id 키를 같이 넣으면 U_Unified가 같은 Lead로 응집.
 */
export async function postDealer(args: {
  axis?: VoiceAxis;
  entityId?: string;
  nps?: number;
  dealerId?: string;
  event?: string;
}): Promise<VoicePostResult & { jti: string; dealerId: string }> {
  const dealerId = args.dealerId ?? `t_test_dealer_${randomUUID().slice(0, 6)}`;
  const token = await signDealerToken({ dealerId, ...(args.event ? { event: args.event } : {}) });

  const axis = args.axis ?? DEALER_FIXTURE_MINING;
  // axis_data에 entity_id 키 추가 (U_Unified upsert_lead_from_response 에서 사용)
  const axisWithEntity = args.entityId ? { ...axis, entity_id: args.entityId } : axis;
  const seg = expectedSegment(axis);

  const payload = {
    survey_id: 'survey_v1_dealer',
    respondent_type: 'dealer',
    language: 'ru',
    nps: args.nps ?? 9,
    future_subscription: true,
    consent_data_collection: true,
    segment: seg,
    segment_method: 'client_rule',
    segment_confidence: 1.0,
    axis_data: axisWithEntity,
    captured_at: new Date().toISOString(),
    answers: makeDealerAnswers(axis),
    target_company: 'HD건설기계',
  };
  const res = await http({
    method: 'POST', path: '/responses-receive',
    headers: {
      Authorization: `Bearer ${token.jwt}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `t_test_${randomUUID()}`,
    },
    body: JSON.stringify(payload),
  });
  const body = res.bodyJson as { id?: string; segment?: string } | null;
  return {
    status: res.status,
    responseId: body?.id ?? null,
    serverSegment: body?.segment ?? null,
    durationMs: res.durationMs,
    bodyJson: res.bodyJson,
    jti: token.jti,
    dealerId,
  };
}

export async function postVisitor(args: {
  axis?: VoiceAxis;
  entityId?: string;
  nps?: number;
}): Promise<VoicePostResult & { deviceId: string }> {
  const axis = args.axis ?? VISITOR_FIXTURE_CONSTRUCTION;
  const axisWithEntity = args.entityId ? { ...axis, entity_id: args.entityId } : axis;
  const seg = expectedSegment(axis);
  const deviceId = randomUUID();

  const payload = {
    survey_id: 'survey_v1_visitor',
    respondent_type: 'visitor',
    language: 'ru',
    nps: args.nps ?? 8,
    future_subscription: false,
    consent_data_collection: true,
    segment: seg,
    segment_method: 'client_rule',
    segment_confidence: 1.0,
    axis_data: axisWithEntity,
    captured_at: new Date().toISOString(),
    answers: makeVisitorAnswers(axis),
    contact_opted_in: false,
  };
  const res = await http({
    method: 'POST', path: '/responses-receive',
    headers: {
      'X-Device-ID': deviceId,
      'Content-Type': 'application/json',
      'Idempotency-Key': `t_test_${randomUUID()}`,
    },
    body: JSON.stringify(payload),
  });
  const body = res.bodyJson as { id?: string; segment?: string } | null;
  return {
    status: res.status,
    responseId: body?.id ?? null,
    serverSegment: body?.segment ?? null,
    durationMs: res.durationMs,
    bodyJson: res.bodyJson,
    deviceId,
  };
}
