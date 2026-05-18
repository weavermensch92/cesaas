// 정규화 helpers — 클러스터 → LLM 입력 빌드 / 응답 파싱.
// S_20.03 다양화 + S_30.02 결과 검증.

import type { ImageBlock } from './llm.ts';
import { ApiError } from './errors.ts';
import { db } from './db.ts';
import { downloadCapture, toBase64 } from './storage.ts';

const MAX_IMAGES = 5;

export interface CaptureRecord {
  id: string;
  image_path: string | null;
  screen_type: string | null;
  captured_at: string;
}

export interface BuiltCluster {
  clusterId: string;
  entityId: string;
  crmId: string;
  images: ImageBlock[];
  selectedCaptureIds: string[];
}

/**
 * cluster → 5장 선택 (시간순 + 화면 종류 다양화) → base64 ImageBlock.
 */
export async function buildClusterImages(clusterId: string): Promise<BuiltCluster> {
  const { data, error } = await db()
    .from('entity_clusters')
    .select('entity_id, crm_id, capture_ids')
    .eq('id', clusterId)
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'cluster lookup failed', { db: error.message });
  if (!data) throw new ApiError('not_found', 'cluster not found', { cluster_id: clusterId });

  const captureIds = data.capture_ids as string[];
  if (!captureIds?.length) {
    throw new ApiError('conflict', 'cluster has no captures', { cluster_id: clusterId });
  }

  const { data: capRows, error: capErr } = await db()
    .from('captures')
    .select('id, image_path, screen_type, captured_at')
    .in('id', captureIds);
  if (capErr) throw new ApiError('internal_error', 'captures lookup failed', { db: capErr.message });

  const captures = (capRows ?? []) as CaptureRecord[];
  if (captures.length === 0) {
    throw new ApiError('conflict', 'cluster captures missing', { cluster_id: clusterId });
  }

  const ready = captures.filter((c) => c.image_path);
  if (ready.length === 0) {
    throw new ApiError('conflict', 'no finalized images in cluster', { cluster_id: clusterId });
  }

  // 시간순
  ready.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const selected = selectDiverse(ready, MAX_IMAGES);

  const images: ImageBlock[] = [];
  for (const c of selected) {
    const bytes = await downloadCapture(c.image_path!);
    images.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/webp', data: toBase64(bytes) },
    });
  }

  return {
    clusterId,
    entityId: data.entity_id as string,
    crmId: data.crm_id as string,
    images,
    selectedCaptureIds: selected.map((c) => c.id),
  };
}

/**
 * 다양화 선택 — screen_type 별로 라운드 로빈, 시간순 가장 최신부터.
 * S_20.03 § 5.
 */
function selectDiverse(sorted: CaptureRecord[], limit: number): CaptureRecord[] {
  if (sorted.length <= limit) return sorted;
  const byType = new Map<string, CaptureRecord[]>();
  for (const c of sorted) {
    const t = c.screen_type ?? 'unknown';
    const arr = byType.get(t) ?? [];
    arr.push(c);
    byType.set(t, arr);
  }
  const out: CaptureRecord[] = [];
  while (out.length < limit) {
    let added = false;
    for (const arr of byType.values()) {
      if (arr.length > 0 && out.length < limit) {
        out.push(arr.pop()!); // 최신부터
        added = true;
      }
    }
    if (!added) break;
  }
  return out.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
}

// ---------------------------------------------------------------------------
// LLM 응답 파싱·검증
// ---------------------------------------------------------------------------

const FIELD_KEYS = [
  'deal_id', 'deal_code', 'company_name',
  'contact_name', 'contact_phone', 'contact_email',
  'amount', 'currency', 'stage', 'product_model',
  'region', 'date_created', 'responsible_dealer',
] as const;

const CONFIDENCE_KEYS = FIELD_KEYS.filter((k) => k !== 'currency');

export interface ParsedFields {
  fields: Record<string, unknown>;
  confidences: Record<string, number>;
}

/**
 * LLM 텍스트 응답 → JSON 파싱 + schema 검증.
 * 응답이 markdown fence로 감싸져 있어도 추출.
 */
export function parseLlmFields(text: string): ParsedFields {
  const json = stripJsonEnvelope(text);
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch (e) {
    throw new ApiError('llm_failed', 'LLM output is not valid JSON', {
      reason: e instanceof Error ? e.message : 'parse failed',
      sample: text.slice(0, 400),
    });
  }
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('llm_failed', 'LLM output must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) {
    fields[k] = obj[k] ?? null;
  }
  const rawConf = (obj.confidence ?? {}) as Record<string, unknown>;
  const confidences: Record<string, number> = {};
  for (const k of CONFIDENCE_KEYS) {
    const v = Number(rawConf[k]);
    confidences[k] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  return { fields, confidences };
}

function stripJsonEnvelope(text: string): string {
  const trimmed = text.trim();
  // ```json ... ``` 또는 ``` ... ```
  if (trimmed.startsWith('```')) {
    const end = trimmed.lastIndexOf('```');
    const body = trimmed.slice(trimmed.indexOf('\n') + 1, end > 3 ? end : trimmed.length);
    return body.trim();
  }
  return trimmed;
}
