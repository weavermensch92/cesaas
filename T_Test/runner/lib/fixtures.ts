// 테스트 픽스처 — 진짜 Bitrix24 화면은 위버 수동 캡쳐. 자동화 테스트에는 합성 페이로드.

import { randomUUID } from 'node:crypto';

/**
 * 가장 작은 valid WebP — VP8L lossless 1×1 흰 픽셀.
 * 백엔드는 image_format='image/webp' 만 검증하므로 LLM 호출 전까지는 충분.
 */
const WEBP_1x1_BASE64 =
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=';

export function smallWebp(): Uint8Array {
  return new Uint8Array(Buffer.from(WEBP_1x1_BASE64, 'base64'));
}

export interface SensorFixture {
  captureId: string;
  entityId: string;
  url: string;
  urlPath: string;
  capturedAt: string;
  dealerId: string;
  crmId: string;
  bytes: Uint8Array;
}

export function makeSensorFixture(opts: { dealerId: string; entityId?: string }): SensorFixture {
  const entity = opts.entityId ?? String(100000 + Math.floor(Math.random() * 900000));
  return {
    captureId: randomUUID(),
    entityId: entity,
    url: `https://bitrix.gkcompany.pro/crm/deal/details/${entity}/`,
    urlPath: `/crm/deal/details/${entity}/`,
    capturedAt: new Date().toISOString(),
    dealerId: opts.dealerId,
    crmId: 'bitrix24',
    bytes: smallWebp(),
  };
}

// ============================================================================
// Voice — Dealer/Visitor 응답 합성
// ============================================================================

export interface VoiceAxis {
  scale: 'S' | 'M' | 'L' | 'XL';
  usage: string;
  fleet_size: string;
  decision_role: string;
  annual_operating_hours?: string;
  annual_deal_rub?: string;
}

export const DEALER_FIXTURE_MINING: VoiceAxis = {
  scale: 'L',
  usage: 'mining',
  fleet_size: '11+',
  decision_role: 'owner',
  annual_operating_hours: 'high',
  annual_deal_rub: 'large',
};

export const VISITOR_FIXTURE_CONSTRUCTION: VoiceAxis = {
  scale: 'M',
  usage: 'construction_heavy',
  fleet_size: '4-10',
  decision_role: 'purchaser',
};

/** segment 분류 미러 — segments.ts와 동일 우선순위. */
export function expectedSegment(a: VoiceAxis): string {
  if (a.annual_deal_rub === 'large') return 'key_account';
  if (a.usage === 'mining' && (a.scale === 'L' || a.scale === 'XL')) return 'mining';
  if (a.usage === 'construction_heavy' && ['M','L','XL'].includes(a.scale)) return 'construction_heavy';
  if (a.usage === 'forestry') return 'forestry';
  if (a.usage === 'agriculture') return 'agriculture';
  if (a.usage === 'general_construction') return 'general_construction';
  if (a.usage === 'rental') return 'rental';
  return 'other';
}

/** Dealer 답변 묶음 — survey_v1_dealer 시드 미러. */
export function makeDealerAnswers(a: VoiceAxis) {
  return [
    { question_id: 'q_v1d_scale',     answer: a.scale },
    { question_id: 'q_v1d_usage',     answer: a.usage },
    { question_id: 'q_v1d_hours',     answer: a.annual_operating_hours ?? 'mid' },
    { question_id: 'q_v1d_deal_rub',  answer: a.annual_deal_rub ?? 'mid' },
    { question_id: 'q_v1d_fleet',     answer: a.fleet_size },
    { question_id: 'q_v1d_role',      answer: a.decision_role },
    { question_id: 'q_v1d_sat',       answer: 4 },
    { question_id: 'q_v1d_plan',      answer: 'yes' },
    { question_id: 'q_v1d_factors',   answer: ['price', 'reliability', 'service'] },
    { question_id: 'q_v1d_competitor', answer: 'caterpillar' },
    { question_id: 'q_v1d_nps',       answer: 9 },
    { question_id: 'q_v1d_subscribe', answer: true },
    { question_id: 'q_v1d_consent',   answer: true },
  ];
}

export function makeVisitorAnswers(a: VoiceAxis) {
  return [
    { question_id: 'q_v1v_scale', answer: a.scale },
    { question_id: 'q_v1v_usage', answer: a.usage },
    { question_id: 'q_v1v_fleet', answer: a.fleet_size },
    { question_id: 'q_v1v_role',  answer: a.decision_role },
    { question_id: 'q_v1v_sat',   answer: 3 },
    { question_id: 'q_v1v_plan',  answer: 'maybe' },
    { question_id: 'q_v1v_factors',   answer: ['reliability', 'parts'] },
    { question_id: 'q_v1v_channels',  answer: ['trade_show', 'dealer'] },
    { question_id: 'q_v1v_competitor', answer: 'none' },
    { question_id: 'q_v1v_nps',       answer: 8 },
    { question_id: 'q_v1v_subscribe', answer: false },
    { question_id: 'q_v1v_consent',   answer: true },
  ];
}
