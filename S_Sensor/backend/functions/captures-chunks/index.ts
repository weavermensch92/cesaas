/**
 * POST /v1/captures/chunks — Extension 청크 수신.
 *
 * serves: ['dealer']
 * direction: 'upward'
 * related_hypothesis: ['H1']
 * harness: 1
 *
 * 처리:
 *   1. HMAC 검증 (sensor_api_keys + hmac_nonces)
 *   2. Idempotency-Key 룩업 (processed_events, 24h)
 *   3. 첫 청크면 captures INSERT (status='received')
 *   4. capture_chunks INSERT (bytea bytes + chunk_hash)
 *   5. Idempotency 기록 + 응답
 *
 * 합성·분류는 finalize 엔드포인트가 수행.
 */

import { verifyHmac } from 'shared/hmac.ts';
import { lookupIdempotency, recordIdempotency } from 'shared/idempotency.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { sha256Hex } from 'shared/hash.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';

const ROUTE = '/v1/captures/chunks';

interface ChunkPayload {
  capture_id: string;
  chunk_index: number;
  total_chunks: number;
  bytes_b64: string;
  chunk_hash: string;
  meta?: CaptureMeta;
}

interface CaptureMeta {
  crm_id: string;
  dealer_id: string;
  url: string;
  url_path: string;
  captured_at: string;
  title?: string;
  referrer?: string;
  spa_enter_time?: number;
  viewport?: { width: number; height: number; dpr: number };
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req); if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') {
      throw new ApiError('bad_request', 'method not allowed', { method: req.method });
    }

    const bodyText = await req.text();
    const bodyBytes = new TextEncoder().encode(bodyText);
    const requestHash = await sha256Hex(bodyBytes);

    // 1) HMAC 검증
    const identity = await verifyHmac(req, bodyBytes);

    // 2) Idempotency 룩업
    const idemKey = req.headers.get('idempotency-key');
    if (idemKey) {
      const hit = await lookupIdempotency({ key: idemKey, route: ROUTE, requestHash });
      if (hit.hit) {
        log.info('idempotency hit', { key: idemKey });
        return jsonResponse(hit.status, hit.body, log.requestId);
      }
    }

    // 3) Payload 파싱·검증
    const payload = parsePayload(bodyText);
    enforceDealer(payload, identity.dealerId);

    // 4) 첫 청크 — captures INSERT
    if (payload.chunk_index === 0) {
      await ensureCaptureRow(payload, identity);
    }

    // 5) capture_chunks INSERT (멱등 — UNIQUE 위반은 무시)
    await insertChunkRow(payload);

    // 6) 응답
    const body = {
      capture_id: payload.capture_id,
      chunk_index: payload.chunk_index,
      received_at: new Date().toISOString(),
    };
    if (idemKey) {
      await recordIdempotency({
        key: idemKey, route: ROUTE, requestHash,
        status: 200, body,
      });
    }
    log.info('chunk received', {
      capture_id: payload.capture_id,
      chunk_index: payload.chunk_index,
      total_chunks: payload.total_chunks,
      dealer_id: identity.dealerId,
    });
    return jsonResponse(200, body, log.requestId);
  } catch (err) {
    log.error('chunk handler failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

function parsePayload(text: string): ChunkPayload {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    throw new ApiError('bad_request', 'body is not valid JSON');
  }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be an object');
  const o = raw as Record<string, unknown>;
  const captureId = String(o.capture_id ?? '');
  const chunkIndex = Number(o.chunk_index);
  const totalChunks = Number(o.total_chunks);
  const bytesB64 = String(o.bytes_b64 ?? '');
  const chunkHash = String(o.chunk_hash ?? '');
  if (!captureId || !bytesB64 || !chunkHash) {
    throw new ApiError('validation_failed', 'missing fields', {
      have: { capture_id: !!captureId, bytes_b64: !!bytesB64, chunk_hash: !!chunkHash },
    });
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new ApiError('validation_failed', 'chunk_index must be a non-negative integer');
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    throw new ApiError('validation_failed', 'total_chunks must be a positive integer');
  }
  const meta = o.meta && typeof o.meta === 'object'
    ? (o.meta as CaptureMeta)
    : undefined;
  return {
    capture_id: captureId,
    chunk_index: chunkIndex,
    total_chunks: totalChunks,
    bytes_b64: bytesB64,
    chunk_hash: chunkHash,
    ...(meta ? { meta } : {}),
  };
}

function enforceDealer(payload: ChunkPayload, dealerFromKey: string | null): void {
  // 글로벌 키(dealerFromKey=null)면 통과. dealer 단위 키면 meta.dealer_id 일치 필요.
  if (!dealerFromKey) return;
  if (!payload.meta) return; // chunk_index > 0 — meta 없음 통과
  if (payload.meta.dealer_id !== dealerFromKey) {
    throw new ApiError('forbidden', 'dealer_id does not match key binding', {
      payload: payload.meta.dealer_id, key: dealerFromKey,
    });
  }
}

async function ensureCaptureRow(payload: ChunkPayload, identity: { dealerId: string | null }): Promise<void> {
  const meta = payload.meta;
  if (!meta) {
    throw new ApiError('validation_failed', 'first chunk must include meta');
  }
  const dealerId = meta.dealer_id || identity.dealerId || '';
  if (!dealerId) throw new ApiError('validation_failed', 'dealer_id missing');

  const { error } = await db().from('captures').upsert({
    id: payload.capture_id,
    crm_id: meta.crm_id,
    dealer_id: dealerId,
    url: meta.url,
    url_path: meta.url_path,
    title: meta.title ?? null,
    referrer: meta.referrer ?? null,
    spa_enter_time: meta.spa_enter_time ?? null,
    viewport_width: meta.viewport?.width ?? null,
    viewport_height: meta.viewport?.height ?? null,
    viewport_dpr: meta.viewport?.dpr ?? null,
    captured_at: meta.captured_at,
    total_chunks: payload.total_chunks,
    status: 'received',
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) {
    if (error.code === '23503') {
      // FK to crm_definitions 위반 — 알 수 없는 CRM
      throw new ApiError('validation_failed', 'unknown crm_id', { crm_id: meta.crm_id });
    }
    throw new ApiError('internal_error', 'capture upsert failed', { db: error.message });
  }
}

async function insertChunkRow(payload: ChunkPayload): Promise<void> {
  const bytes = base64ToBytes(payload.bytes_b64);
  // 서버 측 hash 재계산 + 검증
  const expected = await sha256Hex(bytes);
  if (expected !== payload.chunk_hash) {
    throw new ApiError('validation_failed', 'chunk hash mismatch', {
      expected, claimed: payload.chunk_hash,
    });
  }
  const { error } = await db().from('capture_chunks').insert({
    capture_id: payload.capture_id,
    chunk_index: payload.chunk_index,
    total_chunks: payload.total_chunks,
    bytes,
    chunk_hash: payload.chunk_hash,
  });
  if (error && error.code !== '23505') {
    throw new ApiError('internal_error', 'chunk insert failed', { db: error.message });
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
