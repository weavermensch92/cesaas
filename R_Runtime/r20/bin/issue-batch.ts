#!/usr/bin/env -S node --import=tsx
/**
 * R_20 CLI — 일괄 발급. CSV 또는 콤마 구분된 dealer 목록 입력.
 *
 * 사용 (CSV):
 *   npm run issue-batch -w @hd/r20 -- \
 *     --csv ./dealers.csv --event ctt_moscow_2026 --ttl 48
 *
 *   CSV 포맷: 한 줄에 한 dealer_id (헤더 없음). # 으로 시작하는 줄은 주석.
 *
 * 사용 (inline):
 *   npm run issue-batch -w @hd/r20 -- \
 *     --dealers dealer_001,dealer_002,dealer_003 --event ctt_moscow_2026
 *
 * 결과: stdout JSON array, QR 파일은 R20_OUT_DIR.
 */

import { readFile } from 'node:fs/promises';
import { issueToken, type IssueResult } from '../lib/issue.js';

interface CliArgs {
  csv?: string;
  dealers?: string;
  event?: string;
  ttl?: string;
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
    }
  }
  return out;
}

async function loadDealers(args: CliArgs): Promise<string[]> {
  if (args.csv) {
    const text = await readFile(args.csv, 'utf8');
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
  }
  if (args.dealers) {
    return args.dealers.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.event) {
    console.error('USAGE: issue-batch (--csv <file> | --dealers a,b,c) --event <slug> [--ttl <hours>]');
    process.exit(2);
  }
  const dealers = await loadDealers(args);
  if (dealers.length === 0) {
    console.error('no dealers — provide --csv or --dealers');
    process.exit(2);
  }
  const ttlHours = args.ttl ? Number(args.ttl) : undefined;

  const results: Array<{ dealer_id: string } & Partial<IssueResult> & { error?: string }> = [];
  for (const dealer of dealers) {
    try {
      const r = await issueToken({
        dealerId: dealer,
        event: args.event,
        ...(ttlHours !== undefined ? { ttlHours } : {}),
      });
      results.push({ dealer_id: dealer, jti: r.jti, url: r.url, expiresAt: r.expiresAt, pngPath: r.pngPath, svgPath: r.svgPath });
      process.stderr.write(`  ✓ ${dealer} → ${r.pngPath}\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ dealer_id: dealer, error: msg });
      process.stderr.write(`  ✗ ${dealer}: ${msg}\n`);
    }
  }

  process.stdout.write(JSON.stringify({
    event: args.event,
    issued: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    results,
  }, null, 2) + '\n');
}

main();
