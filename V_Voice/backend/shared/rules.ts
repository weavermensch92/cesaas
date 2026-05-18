// R_10 룰 로더 — DB rule_versions(status='active')에서 fetch + 5분 캐시.
// C_05_LLM_정책 § 6: 하드코드 금지 — 룰은 외부 (DB).

import { parse as parseYaml } from 'yaml';
import { db } from './db.ts';
import { ApiError } from './errors.ts';

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  body: Record<string, unknown>;
  version: string;
  at: number;
}

const cache = new Map<string, CacheEntry>();

export interface LoadedRule<T = Record<string, unknown>> {
  body: T;
  version: string;
}

/**
 * rule_id 로 active 룰 fetch.
 *   loadRule('R_10.06_PromptTemplates')
 */
export async function loadRule<T = Record<string, unknown>>(
  ruleId: string,
): Promise<LoadedRule<T>> {
  const hit = cache.get(ruleId);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { body: hit.body as T, version: hit.version };
  }

  const { data, error } = await db()
    .from('rule_versions')
    .select('version, body_yaml, body_json')
    .eq('rule_id', ruleId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'rule fetch failed', { db: error.message });
  if (!data) throw new ApiError('not_found', `rule not found: ${ruleId}`);

  let parsed: unknown;
  if (data.body_json) {
    parsed = data.body_json;
  } else {
    try { parsed = parseYaml(data.body_yaml as string); }
    catch (e) {
      throw new ApiError('internal_error', `rule YAML parse failed: ${ruleId}`, {
        reason: e instanceof Error ? e.message : 'parse failed',
      });
    }
  }
  if (parsed == null || typeof parsed !== 'object') {
    throw new ApiError('internal_error', `rule must be an object: ${ruleId}`);
  }

  const entry: CacheEntry = {
    body: parsed as Record<string, unknown>,
    version: data.version as string,
    at: Date.now(),
  };
  cache.set(ruleId, entry);
  return { body: entry.body as T, version: entry.version };
}

export function clearRulesCache(): void {
  cache.clear();
}
