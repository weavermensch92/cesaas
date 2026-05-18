'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import { getVoiceAggregates, type VoiceAggregates } from '@/lib/api';

const LANG: Lang = 'ko';

const SEG_COLOR: Record<string, string> = {
  mining: 'var(--seg-mining)',
  key_account: 'var(--seg-key-account)',
  construction_heavy: 'var(--seg-construction-heavy)',
  agriculture: 'var(--seg-agriculture)',
  forestry: 'var(--seg-forestry)',
  general_construction: 'var(--seg-general-construction)',
  rental: 'var(--seg-rental)',
  other: 'var(--seg-other)',
};

export default function VoiceAggregatesPage() {
  return (
    <AuthGate>
      {(s) => <View email={s.user.email ?? ''} />}
    </AuthGate>
  );
}

function View({ email }: { email: string }) {
  const t = makeT(LANG);
  const [filters, setFilters] = useState<{ from?: string; to?: string; event?: string }>({});
  const [agg, setAgg] = useState<VoiceAggregates | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchAgg = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setAgg(await getVoiceAggregates(filters)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetchAgg(); }, [fetchAgg]);
  const signOut = () => getSupabase().auth.signOut();

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <h1 className="hd-h1" style={{ margin: '6px 0 6px' }}>{t('product')} · Insight v0</h1>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>V_30.03 · segment 분포 · NPS · event·언어</p>

        <div className="hd-card" style={{ marginBottom: 12, padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hd-eyebrow">기간</span>
          <input type="date"
            value={filters.from ?? ''}
            onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
            style={dateStyle()} />
          <span className="hd-meta">~</span>
          <input type="date"
            value={filters.to ?? ''}
            onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
            style={dateStyle()} />

          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />
          <span className="hd-eyebrow">Event</span>
          <input type="text" placeholder="ctt_moscow_2026"
            value={filters.event ?? ''}
            onChange={(e) => setFilters({ ...filters, event: e.target.value || undefined })}
            style={dateStyle(200)} />

          <span style={{ marginLeft: 'auto' }} />
          <button className="hd-btn" onClick={fetchAgg} disabled={loading}>{loading ? '...' : '↻ Refresh'}</button>
        </div>

        {err && (
          <div className="hd-card" style={{ padding: 10, marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        {agg && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 14 }}>
              <KPI label="총 응답"    value={agg.total} />
              <KPI label="NPS 평균"   value={agg.nps.avg ?? '–'} sub={`${agg.nps.count}건`} />
              <KPI label="Promoters" value={agg.nps.promoters} sub={pct(agg.nps.promoters, agg.nps.count)} accent="green" />
              <KPI label="Detractors" value={agg.nps.detractors} sub={pct(agg.nps.detractors, agg.nps.count)} accent="red" />
            </div>

            <div className="hd-card" style={{ marginBottom: 14 }}>
              <div className="hd-card-hd"><span className="hd-card-title">Segment 분포</span>
                <span className="hd-card-sub">{agg.by_segment.length}개 segment · {agg.truncated ? '+10K (truncated)' : 'full'}</span>
              </div>
              <div style={{ padding: 12 }}>
                {agg.by_segment.length === 0 && <span className="hd-meta">데이터 없음</span>}
                {agg.by_segment.map((s) => (
                  <SegBar key={s.segment} segment={s.segment} dealer={s.dealer} visitor={s.visitor} total={s.total} max={Math.max(...agg.by_segment.map(x => x.total), 1)} />
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="hd-card">
                <div className="hd-card-hd"><span className="hd-card-title">Event</span></div>
                <table className="hd-table">
                  <tbody>
                    {agg.by_event.length === 0
                      ? <tr><td className="hd-meta">데이터 없음</td></tr>
                      : agg.by_event.map((e) => (
                        <tr key={e.event}><td>{e.event}</td><td className="hd-num" style={{ textAlign:'right' }}>{e.count}</td></tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="hd-card">
                <div className="hd-card-hd"><span className="hd-card-title">Language</span></div>
                <table className="hd-table">
                  <tbody>
                    {agg.by_language.length === 0
                      ? <tr><td className="hd-meta">데이터 없음</td></tr>
                      : agg.by_language.map((l) => (
                        <tr key={l.language}><td>{l.language}</td><td className="hd-num" style={{ textAlign:'right' }}>{l.count}</td></tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function pct(n: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function KPI({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: 'green' | 'red' }) {
  const color = accent === 'green' ? 'var(--hd-prosperity)'
    : accent === 'red' ? 'var(--hd-red)' : 'var(--hd-trust)';
  return (
    <div className="hd-card" style={{ padding: 14 }}>
      <div className="hd-eyebrow">{label}</div>
      <div style={{ font: '700 28px/1.0 var(--hd-font-display)', color, marginTop: 6 }}>{value}</div>
      {sub && <div className="hd-meta" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SegBar({ segment, dealer, visitor, total, max }: { segment: string; dealer: number; visitor: number; total: number; max: number }) {
  const w = `${Math.round((total / max) * 100)}%`;
  const color = SEG_COLOR[segment] ?? 'var(--seg-other)';
  return (
    <div style={{ display:'grid', gridTemplateColumns:'180px 1fr 60px 80px', gap:10, alignItems:'center', padding:'6px 0' }}>
      <span style={{ fontWeight: 600, color: 'var(--hd-trust)' }}>{segment}</span>
      <div style={{ background:'var(--hd-steel-100)', height: 16, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ width: w, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      <span className="hd-num" style={{ textAlign:'right', color:'var(--hd-trust)', fontWeight:600 }}>{total}</span>
      <span className="hd-meta" style={{ textAlign:'right' }}>D {dealer} · V {visitor}</span>
    </div>
  );
}

function dateStyle(w: number = 140): React.CSSProperties {
  return {
    width: w, height: 28, padding: '0 8px',
    border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
    font: 'inherit', fontSize: 12,
  };
}
