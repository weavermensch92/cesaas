/**
 * R_20.03 Deployment — R_10 YAML 시드 → DB rule_versions(active) publish.
 *
 * 1. C_Common/r_10_rules/<ruleId>.yaml 디스크 읽기
 * 2. YAML 파싱 + 메타 검증 (rule_id 일치·version 존재)
 * 3. publish_rule() RPC 호출 (이전 active → archived + 새 active INSERT + audit)
 * 4. 새 row UUID 반환
 *
 * 운영: 위버가 룰 파일 정정 → 이 CLI → hot reload 5분 안 반영 (shared/rules.ts 캐시 TTL).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parse as parseYaml } from 'yaml';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PublishArgs {
  ruleId: string;                // 'R_10.06_PromptTemplates'
  version?: string;              // 명시 안 하면 YAML version 또는 자동 bump
  actor?: string;                // 기본 'system_cli'
  notes?: string;
  rulesDir?: string;             // 기본 ./C_Common/r_10_rules
  dryRun?: boolean;              // RPC 호출 X — 검증·출력만
}

export interface PublishResult {
  ruleId: string;
  version: string;
  newRowId: string | null;       // dryRun이면 null
  previousVersion: string | null;
  bodyBytes: number;
}

interface EnvConfig {
  supabaseUrl: string;
  serviceKey: string;
}

function loadEnv(): EnvConfig {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl) throw new Error('SUPABASE_URL missing');
  if (!serviceKey)  throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return { supabaseUrl, serviceKey };
}

function resolveRulePath(rulesDir: string, ruleId: string): string {
  if (!/^R_10\.\d+_\w+$/.test(ruleId)) {
    throw new Error(`invalid rule_id format: ${ruleId} (expected R_10.NN_Name)`);
  }
  return path.resolve(rulesDir, `${ruleId}.yaml`);
}

/**
 * Active row 1개 fetch (없으면 null).
 */
async function fetchActive(
  db: SupabaseClient,
  ruleId: string,
): Promise<{ id: string; version: string } | null> {
  const { data, error } = await db
    .from('rule_versions')
    .select('id, version')
    .eq('rule_id', ruleId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`fetch active failed: ${error.message}`);
  return data ?? null;
}

export async function publishRule(args: PublishArgs): Promise<PublishResult> {
  const env = loadEnv();
  const rulesDir = args.rulesDir ?? './C_Common/r_10_rules';
  const filePath = resolveRulePath(rulesDir, args.ruleId);

  // 1. 파일 읽기
  let bodyYaml: string;
  try {
    bodyYaml = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `read failed: ${filePath}\n` +
      `  reason: ${err instanceof Error ? err.message : String(err)}\n` +
      `  hint: --rules-dir 로 다른 경로 지정 가능 (기본 ./C_Common/r_10_rules)`,
    );
  }

  // 2. 파싱 + 메타 검증
  let bodyJson: Record<string, unknown>;
  try {
    bodyJson = parseYaml(bodyYaml) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`YAML parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (bodyJson == null || typeof bodyJson !== 'object') {
    throw new Error(`YAML root must be object (got ${typeof bodyJson})`);
  }

  if (bodyJson.rule_id && bodyJson.rule_id !== args.ruleId) {
    throw new Error(
      `rule_id mismatch: file says "${bodyJson.rule_id}", CLI says "${args.ruleId}"`,
    );
  }

  const version =
    args.version ??
    (bodyJson.version != null ? String(bodyJson.version) : null);
  if (!version) {
    throw new Error('version required (CLI --version or YAML version: field)');
  }

  const actor = args.actor ?? 'system_cli';
  const notes = args.notes ?? `publish-rule.ts ${args.ruleId}@${version}`;

  const db = createClient(env.supabaseUrl, env.serviceKey);

  // 3. 이전 active 조회 (참조용)
  const prev = await fetchActive(db, args.ruleId);

  if (args.dryRun) {
    return {
      ruleId: args.ruleId,
      version,
      newRowId: null,
      previousVersion: prev?.version ?? null,
      bodyBytes: Buffer.byteLength(bodyYaml, 'utf-8'),
    };
  }

  // 4. 동일 version 재발급 차단 (실수 방지)
  if (prev?.version === version) {
    throw new Error(
      `version "${version}" already active for ${args.ruleId}. ` +
      `bump version field or pass --version <new> to retry.`,
    );
  }

  const { data, error } = await db.rpc('publish_rule', {
    p_rule_id:   args.ruleId,
    p_version:   version,
    p_body_yaml: bodyYaml,
    p_body_json: bodyJson,
    p_actor:     actor,
    p_notes:     notes,
  });
  if (error) throw new Error(`publish_rule RPC failed: ${error.message}`);

  return {
    ruleId: args.ruleId,
    version,
    newRowId: data as string,
    previousVersion: prev?.version ?? null,
    bodyBytes: Buffer.byteLength(bodyYaml, 'utf-8'),
  };
}
