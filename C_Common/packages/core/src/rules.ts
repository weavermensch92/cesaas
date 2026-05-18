/**
 * R_10 룰 YAML 로더 — C_05_LLM_정책.md § 6 + 하네스 CLAUDE.md § 5.4.
 *
 * Hot reload: R10_HOT_RELOAD=true 일 때 매 호출 새로 읽음 (dev).
 * Production: 1회 캐시 후 process 수명 동안 유지.
 *
 *   loadRules('R_10.06_PromptTemplates')['sensor_13_fields']
 */

import { parse as parseYaml } from 'yaml';
import { ApiError } from './errors.js';

export interface RuleLoaderOptions {
  /** 룰 디렉토리 (env R10_RULES_DIR로 override) */
  dir?: string;
  /** 매 호출 디스크 read */
  hotReload?: boolean;
  /** 테스트용 — 디스크 대신 in-memory 룰 주입 */
  inMemory?: Record<string, unknown>;
}

const cache = new Map<string, unknown>();

function getEnv(key: string): string | undefined {
  const denoEnv = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv) return denoEnv.get(key);
  if (typeof process !== 'undefined') return process.env[key];
  return undefined;
}

async function readFileText(path: string): Promise<string> {
  const denoEnv = (globalThis as {
    Deno?: { readTextFile(p: string): Promise<string> };
  }).Deno;
  if (denoEnv?.readTextFile) return denoEnv.readTextFile(path);
  const fs = await import('node:fs/promises');
  return fs.readFile(path, 'utf8');
}

function joinPath(dir: string, name: string): string {
  const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/';
  return `${dir}${sep}${name}.yaml`;
}

/**
 * 룰 이름은 파일명에서 .yaml 제거한 슬러그 — 예: `R_10.06_PromptTemplates`.
 */
export async function loadRules<T = Record<string, unknown>>(
  name: string,
  opts: RuleLoaderOptions = {},
): Promise<T> {
  if (opts.inMemory && name in opts.inMemory) {
    return opts.inMemory[name] as T;
  }

  const dir = opts.dir ?? getEnv('R10_RULES_DIR') ?? './C_Common/r_10_rules';
  const hot = opts.hotReload ?? (getEnv('R10_HOT_RELOAD') === 'true');
  const cacheKey = `${dir}::${name}`;

  if (!hot && cache.has(cacheKey)) return cache.get(cacheKey) as T;

  let text: string;
  try {
    text = await readFileText(joinPath(dir, name));
  } catch (err) {
    throw new ApiError('internal_error', `R_10 rule not found: ${name}`, {
      reason: err instanceof Error ? err.message : 'read failed',
      dir,
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new ApiError('internal_error', `R_10 rule YAML parse failed: ${name}`, {
      reason: err instanceof Error ? err.message : 'parse failed',
    });
  }

  if (parsed == null || typeof parsed !== 'object') {
    throw new ApiError('internal_error', `R_10 rule must be an object: ${name}`);
  }

  cache.set(cacheKey, parsed);
  return parsed as T;
}

/**
 * 테스트용 — 캐시 비움.
 */
export function clearRulesCache(): void {
  cache.clear();
}
