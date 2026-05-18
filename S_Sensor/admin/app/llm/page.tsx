'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  getAnthropicKeyMeta, rotateAnthropicKey, getLlmUsage,
  type AnthropicKeyMeta, type LlmUsageSummary,
} from '@/lib/api';

const LANG: Lang = 'ko';

export default function LlmPage() {
  return <AuthGate>{(s) => <LlmView email={s.user.email ?? ''} />}</AuthGate>;
}

function LlmView({ email }: { email: string }) {
  const [keyMeta, setKeyMeta] = useState<AnthropicKeyMeta | null>(null);
  const [usage, setUsage] = useState<LlmUsageSummary | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const signOut = () => { getSupabase().auth.signOut(); };

  const refresh = useCallback(async (d: number) => {
    setLoading(true);
    setErr(null);
    try {
      const [k, u] = await Promise.all([getAnthropicKeyMeta(), getLlmUsage(d)]);
      setKeyMeta(k);
      setUsage(u);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(days).catch(() => {}); }, [days, refresh]);

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18, display: 'grid', gap: 18 }}>
        {err && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-red)' }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        <ApiKeyCard meta={keyMeta} onRotated={(m) => { setKeyMeta(m); refresh(days).catch(() => {}); }} />

        <UsageOverview usage={usage} days={days} onDays={setDays} loading={loading} />

        <UsageBreakdown usage={usage} />
      </main>
    </>
  );
}

function ApiKeyCard({ meta, onRotated }: { meta: AnthropicKeyMeta | null; onRotated: (m: AnthropicKeyMeta) => void }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const m = await rotateAnthropicKey(draft.trim());
      onRotated(m);
      setDraft('');
      setMsg('회전 완료 · Vault 저장');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="hd-card" style={{ padding: 18 }}>
      <h2 className="hd-h2" style={{ margin: 0, marginBottom: 12 }}>Anthropic API Key</h2>
      <div className="hd-meta" style={{ marginBottom: 14 }}>
        키는 Supabase Vault 에 암호화 저장 — 평문은 백엔드 service_role 만 복호화. 회전 시 즉시 반영 (60초 캐시).
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span className={`hd-badge ${meta?.present ? 'green' : 'red'}`}>
          {meta?.present ? '설정됨' : '미설정'}
        </span>
        {meta?.present && meta.last_4 && (
          <span className="hd-meta hd-num">···{meta.last_4}</span>
        )}
        {meta?.updated_at && (
          <span className="hd-meta">마지막 회전 · {new Date(meta.updated_at).toLocaleString('ko-KR')}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-api03-..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            flex: '1 1 360px', minWidth: 240,
            height: 36, padding: '0 12px',
            border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
            font: 'inherit', color: 'var(--hd-ink)',
          }}
        />
        <button
          className="hd-btn primary"
          onClick={submit}
          disabled={busy || draft.trim().length < 20}
        >
          {busy ? '저장중…' : meta?.present ? '회전' : '저장'}
        </button>
      </div>
      {msg && <div className="hd-meta" style={{ color: 'var(--hd-green)', marginTop: 10 }}>{msg}</div>}
      {err && <div className="hd-meta" style={{ color: 'var(--hd-red)', marginTop: 10 }}>{err}</div>}
    </div>
  );
}

function UsageOverview({ usage, days, onDays, loading }: { usage: LlmUsageSummary | null; days: number; onDays: (d: number) => void; loading: boolean }) {
  const t = usage?.totals;
  const maxCost = useMemo(() => Math.max(0.001, ...(usage?.by_day.map((d) => d.total_cost_usd) ?? [0])), [usage]);

  return (
    <div className="hd-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <h2 className="hd-h2" style={{ margin: 0 }}>사용 현황</h2>
        <span style={{ flex: 1 }} />
        {[1, 7, 14, 30].map((d) => (
          <span
            key={d}
            className={`hd-snav ${days === d ? 'active' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => onDays(d)}
          >
            최근 {d}일
          </span>
        ))}
        {loading && <span className="hd-meta">로딩…</span>}
      </div>

      {/* 합계 카드들 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Stat label="총 비용" value={t ? `$${t.total_cost_usd.toFixed(4)}` : '–'} tone="green" />
        <Stat label="호출수"  value={t ? t.calls.toLocaleString() : '–'} />
        <Stat label="입력 토큰" value={t ? formatTokens(t.input_tokens) : '–'} />
        <Stat label="출력 토큰" value={t ? formatTokens(t.output_tokens) : '–'} />
        <Stat label="캐시 read" value={t ? formatTokens(t.cache_read_tokens) : '–'} />
        <Stat label="에러"     value={t ? t.errors.toLocaleString() : '–'} tone={t && t.errors > 0 ? 'red' : 'ghost'} />
      </div>

      {/* 일자별 막대 */}
      <div>
        <div className="hd-eyebrow" style={{ marginBottom: 6 }}>일자별 $ 누적</div>
        <table className="hd-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>날짜</th>
              <th>$ 비용</th>
              <th style={{ width: 100, textAlign: 'right' }}>호출</th>
              <th style={{ width: 110, textAlign: 'right' }}>입력</th>
              <th style={{ width: 110, textAlign: 'right' }}>출력</th>
            </tr>
          </thead>
          <tbody>
            {(usage?.by_day ?? []).map((d) => (
              <tr key={d.day}>
                <td className="hd-num">{d.day}</td>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="hd-conf-track" style={{ flex: 1, maxWidth: 240 }}>
                      <span className="hd-conf-fill" style={{ width: `${Math.min(100, (d.total_cost_usd / maxCost) * 100)}%`, background: 'var(--hd-accent)' }} />
                    </span>
                    <span className="hd-num">${d.total_cost_usd.toFixed(4)}</span>
                  </span>
                </td>
                <td className="hd-num" style={{ textAlign: 'right' }}>{d.calls}</td>
                <td className="hd-num" style={{ textAlign: 'right' }}>{formatTokens(d.input_tokens)}</td>
                <td className="hd-num" style={{ textAlign: 'right' }}>{formatTokens(d.output_tokens)}</td>
              </tr>
            ))}
            {(!usage || usage.by_day.length === 0) && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 18 }} className="hd-meta">호출 기록 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsageBreakdown({ usage }: { usage: LlmUsageSummary | null }) {
  // function × model 누적
  const grouped = useMemo(() => {
    if (!usage) return [];
    const m = new Map<string, { function_name: string; model: string; calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; total_cost_usd: number; errors: number; last_day: string }>();
    for (const r of usage.rows) {
      const k = `${r.function_name}|${r.model}`;
      const cur = m.get(k) ?? { function_name: r.function_name, model: r.model, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, total_cost_usd: 0, errors: 0, last_day: r.day };
      cur.calls += r.calls;
      cur.input_tokens += r.input_tokens;
      cur.output_tokens += r.output_tokens;
      cur.cache_read_tokens += r.cache_read_tokens;
      cur.total_cost_usd += r.total_cost_usd;
      cur.errors += r.errors;
      if (r.day > cur.last_day) cur.last_day = r.day;
      m.set(k, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.total_cost_usd - a.total_cost_usd);
  }, [usage]);

  return (
    <div className="hd-card" style={{ padding: 18 }}>
      <h2 className="hd-h2" style={{ margin: 0, marginBottom: 12 }}>Function × Model 분해</h2>
      <table className="hd-table">
        <thead>
          <tr>
            <th>function</th>
            <th>model</th>
            <th style={{ textAlign: 'right' }}>호출</th>
            <th style={{ textAlign: 'right' }}>입력</th>
            <th style={{ textAlign: 'right' }}>출력</th>
            <th style={{ textAlign: 'right' }}>cache read</th>
            <th style={{ textAlign: 'right' }}>$ 누적</th>
            <th style={{ textAlign: 'right' }}>에러</th>
            <th>최근 호출</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((g) => (
            <tr key={`${g.function_name}|${g.model}`}>
              <td>{g.function_name}</td>
              <td className="hd-meta">{g.model}</td>
              <td className="hd-num" style={{ textAlign: 'right' }}>{g.calls}</td>
              <td className="hd-num" style={{ textAlign: 'right' }}>{formatTokens(g.input_tokens)}</td>
              <td className="hd-num" style={{ textAlign: 'right' }}>{formatTokens(g.output_tokens)}</td>
              <td className="hd-num" style={{ textAlign: 'right' }}>{formatTokens(g.cache_read_tokens)}</td>
              <td className="hd-num" style={{ textAlign: 'right' }}>${g.total_cost_usd.toFixed(4)}</td>
              <td className="hd-num" style={{ textAlign: 'right', color: g.errors ? 'var(--hd-red)' : undefined }}>{g.errors}</td>
              <td className="hd-num">{g.last_day}</td>
            </tr>
          ))}
          {grouped.length === 0 && (
            <tr><td colSpan={9} style={{ textAlign: 'center', padding: 18 }} className="hd-meta">데이터 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' | 'ghost' }) {
  const color = tone === 'green' ? 'var(--hd-green)' : tone === 'red' ? 'var(--hd-red)' : undefined;
  return (
    <div className="hd-card" style={{ padding: 12 }}>
      <div className="hd-eyebrow">{label}</div>
      <div className="hd-num" style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}
