#!/usr/bin/env -S node --import=tsx
/**
 * T_04 + T_05 + T_06 일괄 실행.
 *
 * Usage:
 *   npm run all -w @hd/t-test [-- --llm]
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SuiteResult { name: string; code: number; durationMs: number }

function run(script: string, extraArgs: string[]): Promise<SuiteResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const args = [
      '--import=tsx',
      path.join(__dirname, script),
      ...extraArgs,
    ];
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve({
      name: script.replace('.ts', ''),
      code: code ?? 1,
      durationMs: Date.now() - start,
    }));
  });
}

async function main(): Promise<void> {
  const extras = process.argv.slice(2);
  console.log('\n== T_04 Sensor E2E ==');
  const t04 = await run('run-t04.ts', extras);
  console.log('\n== T_05 Voice E2E ==');
  const t05 = await run('run-t05.ts', extras);
  console.log('\n== T_06 Unified E2E (Sensor + Voice → 1 Lead) ==');
  const t06 = await run('run-t06.ts', extras);

  const summary: SuiteResult[] = [t04, t05, t06];
  console.log('\n================================');
  for (const s of summary) {
    const icon = s.code === 0 ? '✓' : '✗';
    console.log(`${icon} ${s.name} — exit ${s.code} (${s.durationMs}ms)`);
  }
  const failed = summary.some((s) => s.code !== 0);
  process.exit(failed ? 1 : 0);
}

main();
