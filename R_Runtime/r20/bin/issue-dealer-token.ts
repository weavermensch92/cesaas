#!/usr/bin/env -S node --import=tsx
/**
 * R_20 CLI — 단일 Bearer JWT 발급 + QR 출력.
 *
 * 사용:
 *   npm run issue-token -w @hd/r20 -- \
 *     --dealer dealer_001 --event ctt_moscow_2026 [--ttl 24]
 *
 * 환경변수 (.env.local):
 *   SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
 *   VOICE_JWT_SECRET · VOICE_JWT_ISSUER
 *   DEALER_BASE_URL  (예: https://dealer.example)
 *   R20_OUT_DIR      (기본 ./R_Runtime/r20/out)
 */

import { issueToken } from '../lib/issue.js';

interface CliArgs {
  dealer?: string;
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
    } else {
      (out as Record<string, string>)[k] = 'true';
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dealer || !args.event) {
    console.error('USAGE: issue-dealer-token --dealer <id> --event <slug> [--ttl <hours>]');
    process.exit(2);
  }
  const ttlHours = args.ttl ? Number(args.ttl) : undefined;
  if (ttlHours !== undefined && (!Number.isFinite(ttlHours) || ttlHours <= 0)) {
    console.error('--ttl must be a positive number of hours');
    process.exit(2);
  }

  try {
    const result = await issueToken({
      dealerId: args.dealer,
      event: args.event,
      ...(ttlHours !== undefined ? { ttlHours } : {}),
    });
    process.stdout.write(JSON.stringify({
      ok: true,
      jti: result.jti,
      dealer_id: args.dealer,
      event: args.event,
      expires_at: result.expiresAt.toISOString(),
      url: result.url,
      qr_png: result.pngPath,
      qr_svg: result.svgPath,
    }, null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`FAIL: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

main();
