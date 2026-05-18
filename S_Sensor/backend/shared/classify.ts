// URL 기반 1차 분류 — S_20.02 § 3.
// DB의 crm_definitions.screen_patterns (JSONB) 사용. 코드에 패턴 하드코드 X.

import { db } from './db.ts';
import { log } from './logger.ts';

export interface ScreenPattern {
  screen: string;
  url_regex: string;
  entity_extract_group?: number;
}

export interface ClassifyResult {
  crm_id: string;
  screen_type: string | null;
  entity_id: string | null;
  confidence: number;
  method: 'url_regex' | 'llm' | 'unknown';
}

const TTL_MS = 5 * 60 * 1000;

interface CrmDef {
  id: string;
  host_pattern: string;
  screen_patterns: ScreenPattern[];
  host_re: RegExp;
  compiled: Array<ScreenPattern & { re: RegExp }>;
}

let cache: { at: number; defs: CrmDef[] } | null = null;

async function loadDefs(): Promise<CrmDef[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.defs;
  const { data, error } = await db()
    .from('crm_definitions')
    .select('id, host_pattern, screen_patterns')
    .eq('status', 'active');
  if (error) {
    log('error', 'crm_definitions load failed', { db: error.message });
    return cache?.defs ?? [];
  }
  const defs: CrmDef[] = (data ?? []).map((row) => {
    const sp = (row.screen_patterns as ScreenPattern[]) ?? [];
    return {
      id: row.id as string,
      host_pattern: row.host_pattern as string,
      screen_patterns: sp,
      host_re: new RegExp(row.host_pattern as string),
      compiled: sp.map((p) => ({ ...p, re: new RegExp(p.url_regex) })),
    };
  });
  cache = { at: Date.now(), defs };
  return defs;
}

/**
 * URL → {crm_id, screen_type, entity_id}.
 *   url: full URL (https://...)
 *   urlPath: pathname + search (matching 대상)
 */
export async function classifyByUrl(url: string, urlPath: string): Promise<ClassifyResult> {
  const defs = await loadDefs();
  for (const def of defs) {
    if (!def.host_re.test(url)) continue;
    for (const p of def.compiled) {
      const m = urlPath.match(p.re);
      if (!m) continue;
      const entityId = p.entity_extract_group != null
        ? (m[p.entity_extract_group] ?? null)
        : null;
      return {
        crm_id: def.id,
        screen_type: p.screen,
        entity_id: entityId,
        confidence: 1.0,
        method: 'url_regex',
      };
    }
    return { crm_id: def.id, screen_type: null, entity_id: null, confidence: 0, method: 'unknown' };
  }
  return { crm_id: '', screen_type: null, entity_id: null, confidence: 0, method: 'unknown' };
}

/** 테스트용 캐시 비움 */
export function clearClassifyCache(): void {
  cache = null;
}
