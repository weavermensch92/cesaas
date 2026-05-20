#!/usr/bin/env -S node --import=tsx
/**
 * T_04 + T_05 + T_06 + T_07 일괄 실행.
 *
 * worker_threads 사용 — 각 시나리오를 Worker로 격리해서:
 *   1) Worker 내부에서 process.exit() 가 부모 process 영향 안 줌.
 *   2) Windows 의 Node child process exit code mis-read (STATUS_STACK_BUFFER_OVERRUN
 *      = 3221226505) 회피 — Worker.on('exit', code) 가 정확한 코드 반환.
 *   3) supabase-js 의 keep-alive fetch cleanup 으로 인한 자식 process 종료 지연도 격리.
 *
 * Usage:
 *   npm run all -w @hd/t-test [-- --llm]
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SuiteResult { name: string; code: number; durationMs: number }

function runInWorker(script: string, extraArgs: string[]): Promise<SuiteResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const scriptPath = path.join(__dirname, script);
    const launcherPath = path.join(__dirname, 'worker-launcher.ts');

    const w = new Worker(launcherPath, {
      execArgv: ['--import=tsx'],
      workerData: { scriptPath },
      argv: extraArgs,
    });

    let captured: number | null = null;
    let exited = false;
    const finish = (code: number) => {
      if (exited) return;
      exited = true;
      resolve({ name: script.replace('.ts', ''), code, durationMs: Date.now() - start });
    };

    w.on('message', (msg: { exitCode?: number }) => {
      if (typeof msg?.exitCode === 'number') {
        captured = msg.exitCode;
        // 메시지 받은 후 즉시 terminate — keep-alive 소켓이 worker 자연 종료를 막아도 강제.
        w.terminate().catch(() => { /* ignore */ });
      }
    });

    w.on('exit', (code) => {
      // captured 가 있으면 그게 더 정확. 없으면 Worker exit code 사용.
      finish(captured ?? code ?? 1);
    });

    w.on('error', (err) => {
      console.error(`[${script}] worker error:`, err.message);
      finish(2);
    });
  });
}

async function main(): Promise<void> {
  const extras = process.argv.slice(2);
  const suites: Array<{ label: string; script: string }> = [
    { label: 'T_04 Sensor E2E',                              script: 'run-t04.ts' },
    { label: 'T_05 Voice E2E',                               script: 'run-t05.ts' },
    { label: 'T_06 Unified E2E (Sensor + Voice → 1 Lead)',   script: 'run-t06.ts' },
    { label: 'T_07 External Control Cycle',                  script: 'run-t07.ts' },
  ];

  const results: SuiteResult[] = [];
  for (const s of suites) {
    console.log(`\n== ${s.label} ==`);
    results.push(await runInWorker(s.script, extras));
  }

  console.log('\n================================');
  for (const r of results) {
    const icon = r.code === 0 ? '✓' : '✗';
    console.log(`${icon} ${r.name} — exit ${r.code} (${r.durationMs}ms)`);
  }
  const failed = results.some((r) => r.code !== 0);
  process.exit(failed ? 1 : 0);
}

main();
