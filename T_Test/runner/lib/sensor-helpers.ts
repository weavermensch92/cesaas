// Sensor 파이프라인 헬퍼 — provision key, send chunks, finalize, polling.

import { db } from './db.js';
import { CONFIG } from './config.js';
import { bytesToBase64, buildHmacHeaders, sha256Hex } from './hmac.js';
import { http } from './http.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SensorFixture } from './fixtures.js';

const CHUNK_SIZE = 16 * 1024;

export interface ProvisionedKey {
  keyId: string;
  secret: string;
}

export async function provisionTestKey(): Promise<ProvisionedKey> {
  const keyId = `t_test_${randomUUID().slice(0, 8)}`;
  const secret = randomBytes(32).toString('hex');
  const { error } = await db().from('sensor_api_keys').insert({
    key_id: keyId,
    secret,
    dealer_id: null,
    description: 'T_04 E2E test key (auto-revoked after run)',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`sensor_api_keys INSERT failed: ${error.message}`);
  return { keyId, secret };
}

export async function revokeKey(keyId: string): Promise<void> {
  await db().from('sensor_api_keys').update({ revoked_at: new Date().toISOString() }).eq('key_id', keyId);
}

function chunkBytes(bytes: Uint8Array, size = CHUNK_SIZE): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.subarray(i, Math.min(i + size, bytes.length)));
  }
  if (out.length === 0) out.push(bytes);
  return out;
}

export async function sendAllChunks(key: ProvisionedKey, fx: SensorFixture): Promise<{
  totalChunks: number;
  fullHashHex: string;
  statuses: number[];
}> {
  const chunks = chunkBytes(fx.bytes);
  const total = chunks.length;
  const fullHashHex = await sha256Hex(fx.bytes);
  const statuses: number[] = [];

  for (let i = 0; i < total; i += 1) {
    const bytes = chunks[i]!;
    const bodyObj = {
      capture_id: fx.captureId,
      chunk_index: i,
      total_chunks: total,
      bytes_b64: bytesToBase64(bytes),
      chunk_hash: await sha256Hex(bytes),
      meta: i === 0 ? {
        crm_id: fx.crmId,
        dealer_id: fx.dealerId,
        url: fx.url,
        url_path: fx.urlPath,
        captured_at: fx.capturedAt,
        title: 'Test Capture',
        viewport: { width: 1920, height: 1080, dpr: 1 },
      } : undefined,
    };
    const bodyStr = JSON.stringify(bodyObj);
    const headers = await buildHmacHeaders({
      method: 'POST', path: '/captures-chunks', body: bodyStr,
      keyId: key.keyId, secret: key.secret,
    });
    const res = await http({
      method: 'POST', path: '/captures-chunks',
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': `${fx.captureId}-chunk-${i}` },
      body: bodyStr,
    });
    statuses.push(res.status);
  }

  return { totalChunks: total, fullHashHex, statuses };
}

export async function sendFinalize(key: ProvisionedKey, fx: SensorFixture, totalChunks: number, fullHashHex: string): Promise<{
  status: number;
  body: unknown;
  durationMs: number;
}> {
  const bodyObj = {
    capture_id: fx.captureId,
    total_chunks: totalChunks,
    finalize_hash: fullHashHex,
  };
  const bodyStr = JSON.stringify(bodyObj);
  const headers = await buildHmacHeaders({
    method: 'POST', path: '/captures-finalize', body: bodyStr,
    keyId: key.keyId, secret: key.secret,
  });
  const res = await http({
    method: 'POST', path: '/captures-finalize',
    headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': `${fx.captureId}-finalize` },
    body: bodyStr,
  });
  return { status: res.status, body: res.bodyJson, durationMs: res.durationMs };
}

/**
 * entity_clusters에서 (entity_id, crm_id) 매칭 row 폴링 — status==='normalized' 또는 timeout.
 */
export async function pollClusterNormalized(fx: SensorFixture, timeoutMs = CONFIG.normalizeTimeoutMs): Promise<{
  found: boolean;
  status?: string;
  clusterId?: string;
  imageCount?: number;
  normalizedFieldsId?: string | null;
  waitedMs: number;
}> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await db()
      .from('entity_clusters')
      .select('id, status, image_count, normalized_fields_id')
      .eq('entity_id', fx.entityId)
      .eq('crm_id', fx.crmId)
      .maybeSingle();
    if (data) {
      if (data.status === 'normalized') {
        return {
          found: true,
          status: data.status as string,
          clusterId: data.id as string,
          imageCount: data.image_count as number,
          normalizedFieldsId: (data.normalized_fields_id as string | null) ?? null,
          waitedMs: Date.now() - start,
        };
      }
      if (data.status === 'pending_normalize' || data.status === 'normalizing') {
        // 큐에 들어가 있음 — 계속 폴
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const { data } = await db()
    .from('entity_clusters')
    .select('id, status, image_count, normalized_fields_id')
    .eq('entity_id', fx.entityId)
    .eq('crm_id', fx.crmId)
    .maybeSingle();
  const result: {
    found: boolean;
    status?: string;
    clusterId?: string;
    imageCount?: number;
    normalizedFieldsId?: string | null;
    waitedMs: number;
  } = {
    found: !!data,
    normalizedFieldsId: (data?.normalized_fields_id as string | null | undefined) ?? null,
    waitedMs: Date.now() - start,
  };
  if (data?.status !== undefined) result.status = data.status as string;
  if (data?.id !== undefined) result.clusterId = data.id as string;
  if (data?.image_count !== undefined) result.imageCount = data.image_count as number;
  return result;
}

export async function cleanupSensorFixture(fx: SensorFixture, clusterId?: string): Promise<void> {
  // 역순 cleanup — children first
  if (clusterId) {
    await db().from('normalized_fields').delete().eq('cluster_id', clusterId);
    await db().from('normalize_queue').delete().eq('cluster_id', clusterId);
    await db().from('entity_clusters').delete().eq('id', clusterId);
  }
  await db().from('capture_chunks').delete().eq('capture_id', fx.captureId);
  await db().from('captures').delete().eq('id', fx.captureId);
  // Storage 이미지 정리 (yyyy-mm/{id}.webp)
  const d = new Date(fx.capturedAt);
  const path = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}/${fx.captureId}.webp`;
  await db().storage.from('captures').remove([path]).catch(() => {});
}
