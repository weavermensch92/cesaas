'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import { getTestSummary, type TestMetric, type TestSummary } from '@/lib/api';

const LANG: Lang = 'ko';

const VERDICT_TONE = {
  pass: 'green',
  partial: 'amber',
  fail: 'red',
  insufficient_data: 'ghost',
} as const;

const VERDICT_LABEL_KO = {
  pass: '✓ 전체 통과 — 종합 PoC 성공',
  partial: '△ 부분 통과 — 우회 시나리오 검토',
  fail: '✗ 미달 — 재설계 검토',
  insufficient_data: '↷ 데이터 부족 — 실행 추가 필요',
} as const;

export default function TTestPage() {
  return (
    <AuthGate>{({ session: s }) => <View email={s.user.email ?? ''} />}</AuthGate>
  );
}

function View({ email }: { email: string }) {
  const _t = makeT(LANG);
  const [summary, setSummary] = useState<TestSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<7 | 14 | 30 | 'all'>(7);

  const reload = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const since = windowDays === 'all'
        ? new Date(0).toISOString()
        : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      setSummary(await getTestSummary(since));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [windowDays]);

  useEffect(() => { reload(); }, [reload]);
  const signOut = () => getSupabase().auth.signOut();

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <h1 className="hd-h1" style={{ margin: '6px 0 4px' }}>T_08 · 통과 판정</h1>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>
          정량 9 지표 · 가설별 누적 · 최근 runs · D11 보고용
        </p>

        <div className="hd-card" style={{ marginBottom: 14, padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hd-eyebrow">집계 기간</span>
          {(['7','14','30','all'] as const).map((d) => (
            <span key={d}
              className={`hd-snav ${String(windowDays) === d ? 'active' : ''}`}
              onClick={() => setWindowDays(d === 'all' ? 'all' : Number(d) as 7 | 14 | 30)}
              style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 12 }}>
              {d === 'all' ? '전체' : `${d}일`}
            </span>
          ))}
          <span style={{ marginLeft: 'auto' }} />
          <button className="hd-btn" disabled={loading} onClick={reload}>{loading ? '...' : '↻ Refresh'}</button>
        </div>

        {err && (
          <div className="hd-card" style={{ padding: 10, marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        {summary && (
          <>
            <Verdict summary={summary} />
            <MetricGrid metrics={summary.metrics} />
            <HypothesisTable rows={summary.hypothesis_breakdown} />
            <RunsTable rows={summary.recent_runs} />
          </>
        )}
      </main>
    </>
  );
}

function Verdict({ summary }: { summary: TestSummary }) {
  const v = summary.verdict;
  const tone = VERDICT_TONE[v.status];
  const label = VERDICT_LABEL_KO[v.status];
  return (
    <div className="hd-card" style={{ padding: 18, marginBottom: 14, background: tone === 'green' ? 'var(--hd-green-50)' : tone === 'amber' ? 'var(--hd-amber-50)' : tone === 'red' ? 'var(--hd-red-50)' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ font: '700 28px var(--hd-font-display)', color: tone === 'green' ? 'var(--hd-prosperity)' : tone === 'amber' ? 'var(--hd-amber)' : tone === 'red' ? 'var(--hd-red)' : 'var(--hd-trust)' }}>
          {v.quantitative_passed}/{v.quantitative_total}
        </span>
        <div>
          <div style={{ font: '600 16px var(--hd-font-display)', color: 'var(--hd-trust)' }}>{label}</div>
          <div className="hd-meta">기준 시각 {summary.since.slice(0, 19).replace('T', ' ')} ~ now · 9 정량 지표</div>
        </div>
        <span style={{ marginLeft: 'auto' }} />
        <span className="hd-meta">실패 {v.quantitative_fail}</span>
      </div>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: TestMetric[] }) {
  return (
    <div className="hd-card" style={{ marginBottom: 14 }}>
      <div className="hd-card-hd">
        <span className="hd-card-title">정량 9 지표</span>
        <span className="hd-card-sub">T_08.01 — Prometheus + DB 쿼리</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, padding: 14 }}>
        {metrics.map((m) => <MetricCard key={m.id} m={m} />)}
      </div>
    </div>
  );
}

function MetricCard({ m }: { m: TestMetric }) {
  const tone = m.status === 'pass' ? 'green'
    : m.status === 'warn' ? 'amber'
    : m.status === 'fail' ? 'red'
    : 'ghost';
  const color = tone === 'green' ? 'var(--hd-prosperity)'
    : tone === 'amber' ? 'var(--hd-amber)'
    : tone === 'red' ? 'var(--hd-red)' : 'var(--hd-steel-700)';
  return (
    <div style={{
      border: '1px solid var(--hd-steel-200)',
      borderRadius: 'var(--hd-radius)',
      padding: 12,
      borderLeft: `4px solid ${color}`,
      background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="hd-eyebrow">{m.hypothesis}</span>
        <span className={`hd-badge ${tone}`}>{statusLabel(m.status)}</span>
      </div>
      <div style={{ font: '600 14px var(--hd-font-display)', color: 'var(--hd-trust)', marginTop: 6 }}>
        {m.label}
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ font: '700 24px var(--hd-font-display)', color }}>
          {m.current ?? '–'}
        </span>
        {m.unit && <span className="hd-meta">{m.unit}</span>}
      </div>
      <div className="hd-meta" style={{ marginTop: 4 }}>
        기준: {m.threshold} · 샘플 {m.samples}
        {m.note ? ` · ${m.note}` : ''}
      </div>
    </div>
  );
}

function statusLabel(s: TestMetric['status']): string {
  if (s === 'pass') return 'PASS';
  if (s === 'warn') return 'WARN';
  if (s === 'fail') return 'FAIL';
  return 'NO DATA';
}

function HypothesisTable({ rows }: { rows: TestSummary['hypothesis_breakdown'] }) {
  return (
    <div className="hd-card" style={{ marginBottom: 14 }}>
      <div className="hd-card-hd">
        <span className="hd-card-title">가설별 누적 (test_assertions GROUP BY)</span>
      </div>
      <table className="hd-table">
        <thead>
          <tr><th>가설</th><th>통과</th><th>실패</th><th>스킵</th><th>주 metric</th><th>평균</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }} className="hd-meta">데이터 없음 — runner 실행 필요</td></tr>
          ) : rows.map((r) => (
            <tr key={r.hypothesis}>
              <td><b style={{ color: 'var(--hd-trust)' }}>{r.hypothesis}</b></td>
              <td className="hd-num">{r.pass > 0 ? <span className="hd-badge green">{r.pass}</span> : <span className="hd-meta">0</span>}</td>
              <td className="hd-num">{r.fail > 0 ? <span className="hd-badge red">{r.fail}</span> : <span className="hd-meta">0</span>}</td>
              <td className="hd-num">{r.skip > 0 ? <span className="hd-badge ghost">{r.skip}</span> : <span className="hd-meta">0</span>}</td>
              <td className="hd-meta">{r.sample_metric_name ?? '–'}</td>
              <td className="hd-num">{r.avg_metric != null ? r.avg_metric : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ rows }: { rows: TestSummary['recent_runs'] }) {
  return (
    <div className="hd-card">
      <div className="hd-card-hd">
        <span className="hd-card-title">최근 runs (test_runs)</span>
        <span className="hd-card-sub">{rows.length}건</span>
      </div>
      <table className="hd-table">
        <thead>
          <tr><th>시각</th><th>suite</th><th>scenario</th><th>actor</th><th>상태</th><th>pass</th><th>fail</th><th>ms</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} style={{ textAlign:'center', padding:24 }} className="hd-meta">실행 기록 없음</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id}>
              <td className="hd-num">{r.started_at.slice(5, 16).replace('T', ' ')}</td>
              <td><span className="hd-badge ghost">{r.suite}</span></td>
              <td>{r.scenario}</td>
              <td className="hd-meta">{r.actor}</td>
              <td><RunBadge value={r.status} /></td>
              <td className="hd-num">{r.passed_count}</td>
              <td className="hd-num">{r.failed_count > 0 ? <span style={{ color:'var(--hd-red)' }}>{r.failed_count}</span> : 0}</td>
              <td className="hd-num">{r.duration_ms ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunBadge({ value }: { value: TestSummary['recent_runs'][number]['status'] }) {
  const tone = value === 'passed' ? 'green'
    : value === 'failed' ? 'red'
    : value === 'running' ? 'blue'
    : 'ghost';
  return <span className={`hd-badge ${tone}`}>{value}</span>;
}
