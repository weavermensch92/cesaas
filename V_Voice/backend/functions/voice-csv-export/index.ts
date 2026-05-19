/**
 * GET /voice-csv-export — 응답 CSV 다운로드 (V_30.04).
 *
 * serves: ['hd_admin', 'gridge_admin']
 *
 * Query: voice-responses 와 동일 필터.
 *   anonymize=true → contact_*, device_id 해시화/제거
 *
 * 응답: text/csv; charset=utf-8; UTF-8 BOM 포함 (Excel 호환).
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { sha256Hex } from 'shared/hash.ts';

const MAX_ROWS = 5000;
const COLUMNS = [
  'captured_at', 'respondent_type', 'dealer_id', 'device_id', 'event', 'language',
  'segment', 'segment_confidence', 'nps',
  'future_subscription', 'consent_data_collection', 'contact_opted_in',
  'target_company',
  'contact_name', 'contact_phone', 'contact_email', 'notes',
  'axis_scale', 'axis_usage', 'axis_fleet_size', 'axis_decision_role',
  'axis_annual_operating_hours', 'axis_annual_deal_rub',
];

const PII_COLS = new Set(['contact_name', 'contact_phone', 'contact_email', 'notes']);

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: '/voice-csv-export' });
  try {
    if (req.method !== 'GET') throw new ApiError('bad_request', 'GET only');
    await requireAdmin(req);

    const url = new URL(req.url);
    const p = url.searchParams;
    const anonymize = p.get('anonymize') === 'true';

    let q = db()
      .from('responses')
      .select(
        'captured_at, respondent_type, dealer_id, device_id, event, language, ' +
        'segment, segment_confidence, nps, future_subscription, consent_data_collection, ' +
        'contact_opted_in, target_company, contact_name, contact_phone, contact_email, notes, axis_data'
      );

    const rt = p.get('respondent_type');
    if (rt === 'dealer' || rt === 'visitor') q = q.eq('respondent_type', rt);
    const segs = p.get('segment');
    if (segs) q = q.in('segment', segs.split(',').map((s) => s.trim()).filter(Boolean));
    const event = p.get('event');
    if (event) q = q.eq('event', event);
    const from = p.get('from');
    if (from) q = q.gte('captured_at', from);
    const to = p.get('to');
    if (to) q = q.lte('captured_at', to);
    const dealerId = p.get('dealer_id');
    if (dealerId) q = q.eq('dealer_id', dealerId);
    const target = p.get('target_company');
    if (target) {
      const esc = target.replace(/[\\%_]/g, (c) => '\\' + c);
      q = q.ilike('target_company', `%${esc}%`);
    }

    q = q.order('captured_at', { ascending: false }).limit(MAX_ROWS);

    const { data, error } = await q;
    if (error) throw new ApiError('internal_error', 'csv query failed', { db: error.message });

    const rows = await Promise.all((data ?? []).map(async (r) => buildRow(r as Record<string, unknown>, anonymize)));

    const csv = '﻿' + [
      COLUMNS.join(','),
      ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')),
    ].join('\r\n');

    log.info('csv exported', { rows: rows.length, anonymize });

    const filename = `hd-voice-${anonymize ? 'anon-' : ''}${new Date().toISOString().slice(0,10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'x-request-id': log.requestId,
      },
    });
  } catch (err) {
    log.error('voice-csv-export failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function buildRow(r: Record<string, unknown>, anonymize: boolean): Promise<Record<string, unknown>> {
  const axis = (r.axis_data && typeof r.axis_data === 'object') ? (r.axis_data as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {
    captured_at: r.captured_at,
    respondent_type: r.respondent_type,
    dealer_id: r.dealer_id,
    device_id: r.device_id,
    event: r.event,
    language: r.language,
    segment: r.segment,
    segment_confidence: r.segment_confidence,
    nps: r.nps,
    future_subscription: r.future_subscription,
    consent_data_collection: r.consent_data_collection,
    contact_opted_in: r.contact_opted_in,
    target_company: r.target_company,
    contact_name:  r.contact_name,
    contact_phone: r.contact_phone,
    contact_email: r.contact_email,
    notes:         r.notes,
    axis_scale:                  axis.scale,
    axis_usage:                  axis.usage,
    axis_fleet_size:             axis.fleet_size,
    axis_decision_role:          axis.decision_role,
    axis_annual_operating_hours: axis.annual_operating_hours,
    axis_annual_deal_rub:        axis.annual_deal_rub,
  };
  if (anonymize) {
    for (const k of PII_COLS) out[k] = null;
    out.dealer_id = r.dealer_id ? await hashShort(String(r.dealer_id))   : null;
    out.device_id = r.device_id ? await hashShort(String(r.device_id))   : null;
  }
  return out;
}

async function hashShort(s: string): Promise<string> {
  return (await sha256Hex(`hd_voice_anon:${s}`)).slice(0, 12);
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
