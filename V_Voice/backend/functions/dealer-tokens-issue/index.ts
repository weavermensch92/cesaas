/**
 * POST /dealer-tokens-issue — Admin → Dealer Bearer JWT 발급 (V_30.04).
 *
 * serves: ['hd_admin', 'gridge_admin']
 * direction: 'downward'
 *
 * R_20 CLI(`issue-dealer-token`)의 기능을 Admin Edge로 끌어올린 것.
 * Admin이 자기 책상에서 딜러 계정을 발급·QR 노출 가능.
 *
 * Body:
 *   { dealer_id: string, event: string, ttl_hours?: number, label?: string }
 *
 * 처리:
 *   1. requireAdmin
 *   2. JWT sign (HS256, jti·sub·event·exp)
 *   3. voice_dealer_tokens row INSERT
 *   4. dealer URL 조립 (VOICE_DEALER_BASE_URL)
 *   5. { jti, jwt, url, expires_at } 반환 — QR은 Admin UI(qrcode)에서 렌더
 */

import { SignJWT } from 'jose';
import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, jsonResponse, toJsonResponse, corsPreflight } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { envRequired, envOptional } from 'shared/env.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/dealer-tokens-issue';

const DEALER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const EVENT_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const MAX_TTL_HOURS = 24 * 30; // 30일

interface IssueBody {
  dealer_id: string;
  event: string;
  ttl_hours?: number;
  label?: string;
}

async function parseBody(req: Request): Promise<IssueBody> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError('bad_request', 'invalid JSON'); }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be object');
  const b = raw as Record<string, unknown>;
  const dealer_id = String(b.dealer_id ?? '').trim();
  const event = String(b.event ?? '').trim();
  if (!DEALER_ID_RE.test(dealer_id)) {
    throw new ApiError('validation_failed', 'dealer_id format', { dealer_id });
  }
  if (!EVENT_RE.test(event)) {
    throw new ApiError('validation_failed', 'event format', { event });
  }
  const ttl_hours = b.ttl_hours == null ? 24 : Number(b.ttl_hours);
  if (!Number.isFinite(ttl_hours) || ttl_hours <= 0 || ttl_hours > MAX_TTL_HOURS) {
    throw new ApiError('validation_failed', 'ttl_hours 1..720', { ttl_hours });
  }
  const label = b.label == null ? undefined : String(b.label).slice(0, 200);
  return { dealer_id, event, ttl_hours, ...(label !== undefined ? { label } : {}) };
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') throw new ApiError('bad_request', 'POST only');
    const admin = await requireAdmin(req);
    const body = await parseBody(req);

    const secret = envRequired('VOICE_JWT_SECRET');
    const issuer = envOptional('VOICE_JWT_ISSUER', 'hd-poc');
    const dealerBase = envRequired('VOICE_DEALER_BASE_URL');

    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + body.ttl_hours! * 3600;

    const jwt = await new SignJWT({ role: 'dealer', event: body.event })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setSubject(body.dealer_id)
      .setJti(jti)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(new TextEncoder().encode(secret));

    const expiresAt = new Date(exp * 1000).toISOString();
    const { error } = await db().from('voice_dealer_tokens').insert({
      dealer_id: body.dealer_id,
      event: body.event,
      jti,
      issued_at: new Date(now * 1000).toISOString(),
      expires_at: expiresAt,
      label: body.label ?? null,
      issued_by: admin.email,
    });
    if (error) {
      throw new ApiError('internal_error', 'voice_dealer_tokens INSERT failed', { db: error.message });
    }

    const url = `${dealerBase.replace(/\/$/, '')}/?token=${encodeURIComponent(jwt)}`;
    log.info('dealer token issued', { dealer_id: body.dealer_id, event: body.event, jti });

    return jsonResponse(200, {
      jti,
      dealer_id: body.dealer_id,
      event: body.event,
      issued_at: new Date(now * 1000).toISOString(),
      expires_at: expiresAt,
      label: body.label ?? null,
      issued_by: admin.email,
      url,
      jwt, // QR 표시·복사용 — 회수 불가, Admin만 봄
    }, log.requestId);
  } catch (err) {
    log.error('dealer-tokens-issue failed', err);
    return toJsonResponse(err, log.requestId);
  }
});
