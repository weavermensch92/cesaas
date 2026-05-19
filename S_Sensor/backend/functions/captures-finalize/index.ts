/**
 * POST /v1/captures/finalize — 청크 합성 + 분류 + 클러스터 UPSERT.
 *
 * serves: ['dealer']
 * direction: 'upward'
 * related_hypothesis: ['H1', 'H3']
 * harness: 1
 *
 * 처리:
 *   1. HMAC 검증
 *   2. Idempotency-Key 룩업
 *   3. capture_chunks 조회·정렬·합성·hash 검증
 *   4. Storage `captures/{yyyy-mm}/{capture_id}.webp` 업로드
 *   5. captures UPDATE (image_path·finalize_hash·status='finalized')
 *   6. classifyByUrl(crm_definitions 기반) → entity_id·screen_type
 *   7. captures UPDATE 분류 결과 + status='classified'
 *   8. entity_id 있으면 upsertCluster → status='clustered'
 *   9. capture_chunks 정리 (cluster 트리거 후)
 *  10. Idempotency 기록·응답
 */

import { verifyHmac } from 'shared/hmac.ts';
import { lookupIdempotency, recordIdempotency } from 'shared/idempotency.ts';
import { ApiError, jsonResponse, toJsonResponse , corsPreflight } from 'shared/errors.ts';
import { sha256Hex } from 'shared/hash.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { classifyByUrl, type ClassifyResult } from 'shared/classify.ts';
import { upsertCluster } from 'shared/cluster.ts';

const ROUTE = '/v1/captures/finalize';
const STORAGE_BUCKET = 'captures';

interface FinalizePayload {
  capture_id: string;
  total_chunks: number;
  finalize_hash: string;
}

interface CaptureRow {
  id: string;
  crm_id: string;
  url: string;
  url_path: string;
  total_chunks: number;
  captured_at: string;
  status: string;
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

    await verifyHmac(req, bodyBytes);

    const idemKey = req.headers.get('idempotency-key');
    if (idemKey) {
      const hit = await lookupIdempotency({ key: idemKey, route: ROUTE, requestHash });
      if (hit.hit) {
        log.info('idempotency hit', { key: idemKey });
        return jsonResponse(hit.status, hit.body, log.requestId);
      }
    }

    const payload = parsePayload(bodyText);
    const capture = await loadCapture(payload.capture_id);

    if (payload.total_chunks !== capture.total_chunks) {
      throw new ApiError('validation_failed', 'total_chunks mismatch with capture row', {
        claimed: payload.total_chunks, stored: capture.total_chunks,
      });
    }

    // 1) 청크 조회·합성·hash 검증
    const merged = await assembleChunks(payload.capture_id, payload.total_chunks);
    const actualHash = await sha256Hex(merged);
    if (actualHash !== payload.finalize_hash) {
      throw new ApiError('validation_failed', 'finalize_hash mismatch', {
        actual: actualHash, claimed: payload.finalize_hash,
      });
    }

    // 2) Storage 업로드
    const imagePath = buildStoragePath(payload.capture_id, capture.captured_at);
    await uploadToStorage(imagePath, merged);

    // 3) captures UPDATE — finalized
    await updateCapture(payload.capture_id, {
      image_path: imagePath,
      image_size_bytes: merged.byteLength,
      finalize_hash: payload.finalize_hash,
      finalized_at: new Date().toISOString(),
      status: 'finalized',
    });

    // 4) 분류
    const result = await classifyByUrl(capture.url, capture.url_path);
    log.info('classified', {
      capture_id: capture.id, crm_id: result.crm_id,
      screen_type: result.screen_type, entity_id: result.entity_id, method: result.method,
    });
    await updateCapture(payload.capture_id, {
      screen_type: result.screen_type,
      entity_id: result.entity_id,
      classification_confidence: result.confidence,
      classification_method: result.method,
      classified_at: new Date().toISOString(),
      status: 'classified',
    });

    // 5) 클러스터 UPSERT
    let clusterId: string | null = null;
    if (result.entity_id) {
      const cluster = await upsertCluster({
        entityId: result.entity_id,
        crmId: capture.crm_id,
        captureId: capture.id,
      });
      clusterId = cluster.clusterId;
      await updateCapture(payload.capture_id, { status: 'clustered' });
      log.info('clustered', {
        capture_id: capture.id, cluster_id: clusterId,
        image_count: cluster.imageCount, trigger_ready: cluster.triggered,
      });
    }

    // 6) 청크 정리 — 합성 끝났으므로 BYTEA 회수.
    await cleanupChunks(payload.capture_id);

    const body = {
      capture_id: payload.capture_id,
      status: clusterId ? 'clustered' : 'classified',
      screen_type: result.screen_type,
      entity_id: result.entity_id,
      classification: result.method,
      cluster_id: clusterId,
      image_path: imagePath,
      finalized_at: new Date().toISOString(),
    };
    if (idemKey) {
      await recordIdempotency({
        key: idemKey, route: ROUTE, requestHash,
        status: 200, body,
      });
    }
    return jsonResponse(200, body, log.requestId);
  } catch (err) {
    log.error('finalize failed', err);
    // 실패 시 captures.status = 'failed' (best effort)
    await markFailed(req).catch(() => {});
    return toJsonResponse(err, log.requestId);
  }
});

function parsePayload(text: string): FinalizePayload {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    throw new ApiError('bad_request', 'body is not valid JSON');
  }
  if (!raw || typeof raw !== 'object') throw new ApiError('bad_request', 'body must be an object');
  const o = raw as Record<string, unknown>;
  const captureId = String(o.capture_id ?? '');
  const totalChunks = Number(o.total_chunks);
  const finalizeHash = String(o.finalize_hash ?? '');
  if (!captureId || !finalizeHash) {
    throw new ApiError('validation_failed', 'capture_id and finalize_hash required');
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    throw new ApiError('validation_failed', 'total_chunks must be a positive integer');
  }
  return { capture_id: captureId, total_chunks: totalChunks, finalize_hash: finalizeHash };
}

async function loadCapture(captureId: string): Promise<CaptureRow> {
  const { data, error } = await db()
    .from('captures')
    .select('id, crm_id, url, url_path, total_chunks, captured_at, status')
    .eq('id', captureId)
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'capture lookup failed', { db: error.message });
  if (!data) throw new ApiError('not_found', 'capture not found', { capture_id: captureId });
  return data as CaptureRow;
}

async function assembleChunks(captureId: string, totalChunks: number): Promise<Uint8Array> {
  const { data, error } = await db()
    .from('capture_chunks')
    .select('chunk_index, bytes, chunk_hash')
    .eq('capture_id', captureId)
    .order('chunk_index', { ascending: true });
  if (error) throw new ApiError('internal_error', 'chunks lookup failed', { db: error.message });
  if (!data || data.length === 0) {
    throw new ApiError('conflict', 'no chunks stored for capture', { capture_id: captureId });
  }
  if (data.length !== totalChunks) {
    throw new ApiError('conflict', 'chunk count mismatch', {
      stored: data.length, expected: totalChunks,
    });
  }
  // 누락 검사
  for (let i = 0; i < totalChunks; i += 1) {
    if (data[i].chunk_index !== i) {
      throw new ApiError('conflict', `chunk index ${i} missing`, {
        seen: data.map((r) => r.chunk_index),
      });
    }
  }
  // bytea → Uint8Array. supabase-js는 hex string으로 줄 수도 있음 — 둘 다 처리.
  const parts: Uint8Array[] = data.map((row) => toBytes(row.bytes));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function toBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw === 'string') {
    // PostgREST hex format: "\\x..."
    if (raw.startsWith('\\x') || raw.startsWith('\\X')) {
      const hex = raw.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      return out;
    }
    // base64?
    const binary = atob(raw);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  throw new ApiError('internal_error', 'unrecognized bytea encoding from DB');
}

function buildStoragePath(captureId: string, capturedAt: string): string {
  const d = new Date(capturedAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}/${captureId}.webp`;
}

async function uploadToStorage(path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await db().storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType: 'image/webp',
    upsert: true,
  });
  if (error) {
    throw new ApiError('internal_error', 'storage upload failed', {
      path, msg: error.message,
    });
  }
}

async function updateCapture(captureId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db().from('captures').update(patch).eq('id', captureId);
  if (error) throw new ApiError('internal_error', 'capture update failed', { db: error.message });
}

async function cleanupChunks(captureId: string): Promise<void> {
  const { error } = await db().from('capture_chunks').delete().eq('capture_id', captureId);
  if (error) {
    // 정리 실패는 비-치명 — 30일 cron이 청소.
    console.warn('chunk cleanup failed', captureId, error.message);
  }
}

async function markFailed(req: Request): Promise<void> {
  // 가능한 경우 body에서 capture_id 다시 추출 시도
  try {
    const text = await req.clone().text();
    const o = JSON.parse(text) as { capture_id?: string };
    if (o.capture_id) {
      await db().from('captures').update({ status: 'failed' }).eq('id', o.capture_id);
    }
  } catch {
    // ignore
  }
}
