// harness2/lib/load_rules.ts — YAML 룰 로드 + 메모리 캐시 + hot reload.
// PRD-03 § 4 R-020. NF-P01: 60s 안에 새 룰 적용.
//
// 캐시 정책:
//   - TTL(60s) 안 + DB version 같음 → 캐시 반환
//   - TTL 초과 또는 DB version 다름 → 디스크 재로드
//
// 환경:
//   - Edge Function(Deno) — Deno.readTextFile + npm:yaml
//   - 테스트(Node) — node:fs/promises + npm:yaml
//
// 주의: 현재 prd-v1의 일부 YAML은 아직 단순 스키마 (Phase B.2에서 통일 중).
// 호출부가 strict validation을 요청하면 옵션으로 켤 것 (기본 OFF).

import { parse as parseYaml } from 'yaml';
import type { RuleMeta } from './types.ts';

interface CacheEntry {
  version: number;
  data: unknown;
  loaded_at: number;
}

const ruleCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 60_000;

export interface LoaderConfig {
  /** YAML 파일 디렉토리. 환경변수 R10_RULES_DIR 또는 이 옵션으로 override. */
  yaml_base_path: string;
  /** DB rule_versions에서 current_version 조회 (선택). 있으면 hot reload 정확도 ↑. */
  getCurrentVersion?: (rule_id: string) => Promise<number>;
  /** rule_id / version 메타 강제 검증 (Phase B 완료 후 ON). */
  strict?: boolean;
}

let config: LoaderConfig = {
  yaml_base_path: getEnv('R10_RULES_DIR') ?? './C_Common/r_10_rules',
  strict: false,
};

export function configureLoader(cfg: Partial<LoaderConfig>): void {
  config = { ...config, ...cfg };
}

// ============================================================================
// Public API
// ============================================================================

export async function loadRules<T extends Partial<RuleMeta> = Record<string, unknown>>(
  rule_id: string,
): Promise<T> {
  const cached = ruleCache.get(rule_id);
  const now = Date.now();

  if (cached && (now - cached.loaded_at) < CACHE_TTL_MS) {
    return cached.data as T;
  }

  // DB version 확인 — TTL 초과지만 version 같으면 disk re-read 생략
  if (cached && config.getCurrentVersion) {
    try {
      const current = await config.getCurrentVersion(rule_id);
      if (current === cached.version) {
        cached.loaded_at = now;
        return cached.data as T;
      }
    } catch {
      // DB 조회 실패 — 캐시된 거 우선 (서비스 끊김 방지)
      cached.loaded_at = now;
      return cached.data as T;
    }
  }

  const data = await fetchYaml(rule_id);
  ruleCache.set(rule_id, {
    version: typeof data.version === 'number' ? data.version : 0,
    data,
    loaded_at: now,
  });
  return data as T;
}

export function invalidateCache(rule_id: string): void {
  ruleCache.delete(rule_id);
}

export function clearAllCache(): void {
  ruleCache.clear();
}

export function getCacheStatus(): {
  size: number;
  entries: { rule_id: string; version: number; age_seconds: number }[];
} {
  const now = Date.now();
  return {
    size: ruleCache.size,
    entries: Array.from(ruleCache.entries()).map(([rule_id, e]) => ({
      rule_id,
      version: e.version,
      age_seconds: Math.floor((now - e.loaded_at) / 1000),
    })),
  };
}

// ============================================================================
// 내부 — YAML 읽기 + 검증
// ============================================================================

async function fetchYaml(rule_id: string): Promise<Record<string, unknown>> {
  const path = joinPath(config.yaml_base_path, `${rule_id}.yaml`);
  const text = await readFileText(path);
  const data = parseYaml(text) as Record<string, unknown>;
  if (config.strict) validateMeta(rule_id, data);
  return data;
}

function validateMeta(rule_id: string, data: Record<string, unknown>): void {
  if (!data.rule_id) throw new Error(`Missing rule_id in ${rule_id}`);
  if (data.rule_id !== rule_id) {
    throw new Error(`rule_id mismatch: file=${rule_id}, yaml=${data.rule_id}`);
  }
  if (typeof data.version !== 'number') throw new Error(`Invalid version in ${rule_id}`);
  if (![1, 2].includes(data.harness as number)) {
    throw new Error(`Invalid harness in ${rule_id}: must be 1 or 2`);
  }
}

function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + name;
  return `${dir}/${name}`;
}

async function readFileText(path: string): Promise<string> {
  const deno = (globalThis as { Deno?: { readTextFile(p: string): Promise<string> } }).Deno;
  if (deno?.readTextFile) return deno.readTextFile(path);
  const fs = await import('node:fs/promises');
  return fs.readFile(path, 'utf-8');
}

function getEnv(key: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno?.env) return deno.env.get(key);
  if (typeof process !== 'undefined') return process.env[key];
  return undefined;
}
