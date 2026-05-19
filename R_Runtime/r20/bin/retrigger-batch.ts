#!/usr/bin/env -S node --import=tsx
/**
 * R_20 CLI — cluster_ids[]를 enqueue_normalize_priority RPC로 일괄 재정규화 큐잉.
 *
 * 운영: publish-rule.ts로 R_10.06 prompt 정정 → 이 CLI로 영향받는 cluster 일괄 재처리
 *       → normalize-worker가 새 prompt_version으로 다시 추출 → 정확도 변화 측정.
 *
 * 사용:
 *   # 인자로 직접
 *   npm run retrigger -w @hd/r20 -- --cluster-ids uuid1,uuid2,uuid3
 *
 *   # 파일에서 (한 줄당 1 UUID)
 *   npm run retrigger -w @hd/r20 -- --from-file ./batch.txt
 *
 *   # stdin pipe (cat ids.txt | npm run retrigger ...)
 *   cat ids.txt | npm run retrigger -w @hd/r20 -- --stdin
 *
 * 옵션:
 *   --priority high|normal|low   (기본 high)
 *   --actor <id>                 (기본 system_cli)
 *   --reason <text>              (기본 "retrigger-batch.ts")
 *   --dry-run                    (RPC X — 입력 파싱·count만)
 *
 * 종료 코드:
 *   0 — 전체 성공
 *   1 — 일부 또는 전체 RPC 실패 (각 실패는 stderr에 기록, 처리는 계속)
 *   2 — CLI 인자 오류
 */

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

interface CliArgs {
  'cluster-ids'?: string;
  'from-file'?: string;
  stdin?: string;
  priority?: string;
  actor?: string;
  reason?: string;
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
    'USAGE: retrigger-batch ' +
    '(--cluster-ids u1,u2,u3 | --from-file path | --stdin) ' +
    '[--priority high|normal|low] [--actor <id>] [--reason <text>] [--dry-run]\n',
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function collectIds(args: CliArgs): Promise<string[]> {
  if (args['cluster-ids']) return normalizeIds(args['cluster-ids']);
  if (args['from-file']) {
    const text = await readFile(args['from-file'], 'utf-8');
    return normalizeIds(text);
  }
  if (args.stdin === 'true') {
    const text = await readStdin();
    return normalizeIds(text);
  }
  return [];
}

interface ItemResult {
  cluster_id: string;
  ok: boolean;
  queue_id?: string;
  error?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const ids = await collectIds(args);
  if (ids.length === 0) {
    usage();
    process.stderr.write('no cluster_ids provided\n');
    process.exit(2);
  }

  const invalid = ids.filter((id) => !UUID_RE.test(id));
  if (invalid.length > 0) {
    process.stderr.write(`invalid UUID(s): ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? ` (+${invalid.length - 3})` : ''}\n`);
    process.exit(2);
  }

  const priority = args.priority ?? 'high';
  if (!['high', 'normal', 'low'].includes(priority)) {
    process.stderr.write(`invalid --priority: ${priority} (must be high|normal|low)\n`);
    process.exit(2);
  }

  const actor = args.actor ?? 'system_cli';
  const reason = args.reason ?? 'retrigger-batch.ts';
  const dryRun = args['dry-run'] === 'true';

  if (dryRun) {
    process.stdout.write(JSON.stringify({
      ok: true,
      dry_run: true,
      cluster_count: ids.length,
      priority,
      actor,
      reason,
      sample_ids: ids.slice(0, 5),
    }, null, 2) + '\n');
    return;
  }

  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceKey  = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceKey) {
    process.stderr.write('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing\n');
    process.exit(1);
  }
  const db = createClient(supabaseUrl, serviceKey);

  const results: ItemResult[] = [];
  for (const clusterId of ids) {
    const { data, error } = await db.rpc('enqueue_normalize_priority', {
      p_cluster_id: clusterId,
      p_priority:   priority,
      p_actor:      actor,
      p_reason:     reason,
    });
    if (error) {
      results.push({ cluster_id: clusterId, ok: false, error: error.message });
      process.stderr.write(`FAIL ${clusterId}: ${error.message}\n`);
    } else {
      results.push({ cluster_id: clusterId, ok: true, queue_id: data as string });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  process.stdout.write(JSON.stringify({
    ok: failCount === 0,
    total: results.length,
    succeeded: okCount,
    failed: failCount,
    priority,
    results,
  }, null, 2) + '\n');

  if (failCount > 0) process.exit(1);
}

main();
