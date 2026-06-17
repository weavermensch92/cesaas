// 작은 assertion 헬퍼 — test_runs/test_assertions에 누적.
// 한 줄로 step·hypothesis·metric까지 기록.

import { db } from './db.js';
import { CONFIG } from './config.js';
import { randomUUID } from 'node:crypto';

export interface RunHandle {
  id: string;
  suite: string;
  scenario: string;
  startedAt: number;
  seq: number;
  fixtureSeed: string;
}

export async function startRun(args: {
  suite: 'T_04' | 'T_05' | 'T_06' | 'T_07';
  scenario: string;
  fixtureSeed?: string;
  notes?: string;
}): Promise<RunHandle> {
  const fixtureSeed = args.fixtureSeed ?? randomUUID();
  const { data, error } = await db().from('test_runs').insert({
    suite: args.suite,
    scenario: args.scenario,
    actor: CONFIG.actor,
    env: CONFIG.env,
    fixture_seed: fixtureSeed,
    notes: args.notes,
    status: 'running',
  }).select('id').single();
  if (error) throw new Error(`test_runs INSERT failed: ${error.message}`);
  const id = data.id as string;
  console.log(`\n=== ${args.suite} · ${args.scenario} · run ${id.slice(0,8)} ===`);
  return { id, suite: args.suite, scenario: args.scenario, startedAt: Date.now(), seq: 0, fixtureSeed };
}

export interface AssertOptions {
  step: string;
  name: string;
  hypothesis?: 'H1' | 'H2' | 'H3' | 'H_LLM' | 'V_가설' | 'H_채널통합' | 'H_도달성' | 'H_외부컨트롤' | 'H_하네스2' | 'H_도달성·V_가설';
  expected?: unknown;
  actual?: unknown;
  metric?: { name: string; value: number };
  durationMs?: number;
  error?: string;
}

export async function pass(run: RunHandle, opts: AssertOptions): Promise<void> {
  await record(run, 'pass', opts);
}
export async function fail(run: RunHandle, opts: AssertOptions): Promise<void> {
  await record(run, 'fail', opts);
}
export async function skip(run: RunHandle, opts: AssertOptions): Promise<void> {
  await record(run, 'skip', opts);
}

async function record(run: RunHandle, status: 'pass' | 'fail' | 'skip', opts: AssertOptions): Promise<void> {
  const seq = run.seq++;
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '↷';
  const metric = opts.metric ? ` [${opts.metric.name}=${opts.metric.value}]` : '';
  const dur = opts.durationMs != null ? ` (${opts.durationMs}ms)` : '';
  console.log(`  ${icon} ${opts.step} · ${opts.name}${metric}${dur}${opts.error ? ` — ${opts.error}` : ''}`);

  const insert: Record<string, unknown> = {
    run_id: run.id, seq, step: opts.step, name: opts.name, status,
    hypothesis: opts.hypothesis ?? null,
    duration_ms: opts.durationMs ?? null,
    error: opts.error ?? null,
  };
  if (opts.expected !== undefined) insert.expected = opts.expected;
  if (opts.actual !== undefined) insert.actual = opts.actual;
  if (opts.metric) {
    insert.metric_name = opts.metric.name;
    insert.metric_value = opts.metric.value;
  }
  const { error } = await db().from('test_assertions').insert(insert);
  if (error) {
    console.warn(`  ! test_assertions INSERT failed: ${error.message}`);
  }
}

/**
 * 일반적인 assertion 헬퍼 — expect/actual 비교.
 */
export async function expect<T>(run: RunHandle, opts: AssertOptions & { actual: T; expected: T }): Promise<boolean> {
  const ok = JSON.stringify(opts.actual) === JSON.stringify(opts.expected);
  if (ok) await pass(run, opts);
  else    await fail(run, opts);
  return ok;
}

export async function finishRun(run: RunHandle): Promise<{ passed: number; failed: number; skipped: number; status: string }> {
  const { error } = await db().rpc('finish_test_run', { p_run_id: run.id });
  if (error) console.warn(`finish_test_run failed: ${error.message}`);
  const { data } = await db()
    .from('test_runs')
    .select('passed_count, failed_count, skipped_count, status, duration_ms')
    .eq('id', run.id)
    .single();
  const passed = (data?.passed_count as number | undefined) ?? 0;
  const failed = (data?.failed_count as number | undefined) ?? 0;
  const skipped = (data?.skipped_count as number | undefined) ?? 0;
  const status = (data?.status as string | undefined) ?? 'unknown';
  const dur = (data?.duration_ms as number | undefined) ?? (Date.now() - run.startedAt);
  console.log(`\n→ ${run.suite}·${run.scenario}: ${status} (pass ${passed} · fail ${failed} · skip ${skipped} · ${dur}ms)\n`);
  return { passed, failed, skipped, status };
}
