#!/usr/bin/env -S node --import=tsx
/**
 * R_20.03 CLI — R_10 룰 YAML을 DB rule_versions(active)로 publish.
 *
 * 사용:
 *   npm run publish-rule -w @hd/r20 -- \
 *     --rule R_10.06_PromptTemplates \
 *     [--version 2026-05-19.002] \
 *     [--actor weaver@gridge.co.kr] \
 *     [--notes "fix typo in sensor_13_fields system"] \
 *     [--rules-dir ./C_Common/r_10_rules] \
 *     [--dry-run]
 *
 * 환경변수: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
 *
 * 종료 코드:
 *   0 — 성공
 *   1 — RPC 실패·검증 실패
 *   2 — CLI 인자 오류
 */

import { publishRule } from '../lib/publish.js';

interface CliArgs {
  rule?: string;
  version?: string;
  actor?: string;
  notes?: string;
  'rules-dir'?: string;
  'dry-run'?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith('--')) {
      (out as Record<string, string>)[k] = v;
      i += 1;
    } else {
      (out as Record<string, string>)[k] = 'true';
    }
  }
  return out;
}

function usage(): void {
  process.stderr.write(
    'USAGE: publish-rule --rule <R_10.NN_Name> ' +
    '[--version <v>] [--actor <id>] [--notes <text>] ' +
    '[--rules-dir <path>] [--dry-run]\n',
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.rule) {
    usage();
    process.exit(2);
  }

  try {
    const result = await publishRule({
      ruleId: args.rule,
      ...(args.version  ? { version: args.version } : {}),
      ...(args.actor    ? { actor: args.actor }     : {}),
      ...(args.notes    ? { notes: args.notes }     : {}),
      ...(args['rules-dir'] ? { rulesDir: args['rules-dir'] } : {}),
      dryRun: args['dry-run'] === 'true',
    });

    process.stdout.write(JSON.stringify({
      ok: true,
      rule_id: result.ruleId,
      version: result.version,
      previous_version: result.previousVersion,
      new_row_id: result.newRowId,
      body_bytes: result.bodyBytes,
      dry_run: args['dry-run'] === 'true',
    }, null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`FAIL: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

main();
