// lib/sender.js — 청크 송출 + 재시도 (S_10.04).
// 8회 지수 백오프 — 1·2·4·8·16·30·60·120s.

import { getConfig } from './config.js';
import { buildHmacHeaders, sha256Hex } from './hmac.js';
import { dataUrlToBytes, chunkBytes } from './chunk.js';
import { appendLog, classifyHttp, ErrorCategory } from './error.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 한 capture 전체를 송출 — 청크 N + finalize 1.
 * 성공 시 {ok:true, capture_id}, 실패 시 {ok:false, attempts, reason}.
 */
export async function sendCapture(record) {
  const captureId = record.id;
  const meta = record.meta;
  const imageBytes = dataUrlToBytes(record.data_url);
  const fullHash = await sha256Hex(imageBytes);
  const chunks = chunkBytes(imageBytes);

  // 1) 첫 청크에 metadata 동봉
  for (let i = 0; i < chunks.length; i += 1) {
    const r = await sendOneChunk({
      captureId,
      chunkIndex: i,
      totalChunks: chunks.length,
      bytes: chunks[i],
      meta: i === 0 ? meta : null,
    });
    if (!r.ok) return r;
  }

  // 2) finalize — 모든 청크 합성 + hash 검증
  const fin = await postFinalize({
    captureId,
    totalChunks: chunks.length,
    finalizeHash: fullHash,
  });

  if (!fin.ok) return fin;
  await appendLog({ level: 'info', msg: 'capture sent', capture_id: captureId, chunks: chunks.length });
  return { ok: true, capture_id: captureId };
}

async function sendOneChunk({ captureId, chunkIndex, totalChunks, bytes, meta }) {
  const cfg = await getConfig();
  const path = '/captures-chunks';
  const url = `${cfg.API_BASE}${path}`;
  const idempotencyKey = `${captureId}-chunk-${chunkIndex}`;

  // multipart 대신 단순 JSON 페이로드 — bytes는 base64로 동봉.
  const bodyObj = {
    capture_id: captureId,
    chunk_index: chunkIndex,
    total_chunks: totalChunks,
    bytes_b64: bytesToBase64(bytes),
    chunk_hash: await sha256Hex(bytes),
    meta: meta ?? undefined,
  };
  const bodyStr = JSON.stringify(bodyObj);

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    let status = 0;
    try {
      const headers = await buildHmacHeaders({
        method: 'POST',
        path,
        body: bodyStr,
        secret: cfg.HMAC_SECRET,
        keyId: cfg.API_KEY_ID,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: bodyStr,
      });
      status = res.status;
      if (res.ok) return { ok: true };
      const cat = classifyHttp(res.status);
      if (cat === ErrorCategory.SERVER_4XX) {
        await appendLog({
          level: 'error',
          msg: 'chunk rejected 4xx — giving up',
          capture_id: captureId,
          chunk_index: chunkIndex,
          status: res.status,
        });
        return { ok: false, attempts: attempt + 1, reason: `http_${res.status}` };
      }
      // 429·5xx → 재시도
    } catch (e) {
      await appendLog({
        level: 'warn',
        msg: 'chunk network error',
        capture_id: captureId,
        chunk_index: chunkIndex,
        err: String(e),
        attempt,
      });
    }
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  await appendLog({
    level: 'error',
    msg: 'chunk max retries exceeded',
    capture_id: captureId,
    chunk_index: chunkIndex,
  });
  return { ok: false, attempts: RETRY_DELAYS_MS.length, reason: 'max_retries' };
}

async function postFinalize({ captureId, totalChunks, finalizeHash }) {
  const cfg = await getConfig();
  const path = '/captures-finalize';
  const url = `${cfg.API_BASE}${path}`;
  const bodyObj = {
    capture_id: captureId,
    total_chunks: totalChunks,
    finalize_hash: finalizeHash,
  };
  const bodyStr = JSON.stringify(bodyObj);
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const headers = await buildHmacHeaders({
        method: 'POST',
        path,
        body: bodyStr,
        secret: cfg.HMAC_SECRET,
        keyId: cfg.API_KEY_ID,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Idempotency-Key': `${captureId}-finalize`,
        },
        body: bodyStr,
      });
      if (res.ok) return { ok: true };
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, attempts: attempt + 1, reason: `http_${res.status}` };
      }
    } catch (e) {
      // retry
    }
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return { ok: false, attempts: RETRY_DELAYS_MS.length, reason: 'max_retries_finalize' };
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    );
  }
  return btoa(binary);
}
