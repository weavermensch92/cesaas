'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  downloadVoiceCsv,
  listVoiceResponses,
  type VoiceListFilters,
  type VoiceResponseRow,
} from '@/lib/api';

const LANG: Lang = 'ko';

const SEGMENTS = ['mining','key_account','construction_heavy','agriculture','forestry','general_construction','rental','other'];

export default function VoiceResponsesPage() {
  return (
    <AuthGate>
      {(session) => <View email={session.user.email ?? ''} />}
    </AuthGate>
  );
}

function View({ email }: { email: string }) {
  const t = makeT(LANG);
  const [filters, setFilters] = useState<VoiceListFilters>({ limit: 50 });
  const [rows, setRows] = useState<VoiceResponseRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyCsv, setBusyCsv] = useState(false);

  const fetchPage = useCallback(async (append: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      const page = await listVoiceResponses({ ...filters, cursor: append ? cursor : null });
      setRows((prev) => append ? [...prev, ...page.data] : page.data);
      setCursor(page.next_cursor);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filters, cursor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPage(false).catch(() => {}); }, [filters]);

  const signOut = () => getSupabase().auth.signOut();

  const onCsv = async (anonymize: boolean) => {
    setBusyCsv(true);
    try { await downloadVoiceCsv({ ...filters, anonymize }); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusyCsv(false); }
  };

  const setSeg = (seg: string | undefined) => {
    if (!seg) { setFilters({ ...filters, segment: undefined }); return; }
    const cur = filters.segment?.split(',').filter(Boolean) ?? [];
    const next = cur.includes(seg) ? cur.filter((s) => s !== seg) : [...cur, seg];
    setFilters({ ...filters, segment: next.length ? next.join(',') : undefined });
  };
  const segActive = (s: string) => (filters.segment?.split(',') ?? []).includes(s);

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <h1 className="hd-h1" style={{ margin: '6px 0 6px' }}>{t('product')} · Responses</h1>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>V_30.01 · cursor pagination · filters</p>

        {/* Filter bar */}
        <div className="hd-card" style={{ marginBottom: 12, padding: 12, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
          <span className="hd-eyebrow">유형</span>
          <Chip active={!filters.respondent_type} onClick={() => setFilters({ ...filters, respondent_type: undefined })}>All</Chip>
          <Chip active={filters.respondent_type === 'dealer'}  onClick={() => setFilters({ ...filters, respondent_type: 'dealer' })}>Dealer</Chip>
          <Chip active={filters.respondent_type === 'visitor'} onClick={() => setFilters({ ...filters, respondent_type: 'visitor' })}>Visitor</Chip>

          <span style={{ width:1, height:18, background:'var(--hd-steel-200)' }} />
          <span className="hd-eyebrow">Segment</span>
          {SEGMENTS.map((s) => (
            <Chip key={s} active={segActive(s)} onClick={() => setSeg(s)}>{s}</Chip>
          ))}
          <button className="hd-btn ghost sm" onClick={() => setSeg(undefined)}>clear</button>

          <span style={{ width:1, height:18, background:'var(--hd-steel-200)' }} />
          <span className="hd-eyebrow">NPS</span>
          <input type="number" min={0} max={10} placeholder="min"
            value={filters.nps_min ?? ''}
            onChange={(e) => setFilters({ ...filters, nps_min: e.target.value === '' ? undefined : Number(e.target.value) })}
            style={inputStyle(60)} />
          <input type="number" min={0} max={10} placeholder="max"
            value={filters.nps_max ?? ''}
            onChange={(e) => setFilters({ ...filters, nps_max: e.target.value === '' ? undefined : Number(e.target.value) })}
            style={inputStyle(60)} />

          <span style={{ width:1, height:18, background:'var(--hd-steel-200)' }} />
          <span className="hd-eyebrow">Opt-in</span>
          <Chip active={!filters.contact_opted_in} onClick={() => setFilters({ ...filters, contact_opted_in: undefined })}>All</Chip>
          <Chip active={filters.contact_opted_in === 'true'}  onClick={() => setFilters({ ...filters, contact_opted_in: 'true' })}>Yes</Chip>
          <Chip active={filters.contact_opted_in === 'false'} onClick={() => setFilters({ ...filters, contact_opted_in: 'false' })}>No</Chip>

          <span style={{ marginLeft: 'auto' }} />
          <button className="hd-btn"          disabled={busyCsv} onClick={() => onCsv(false)}>CSV</button>
          <button className="hd-btn primary"  disabled={busyCsv} onClick={() => onCsv(true)}>CSV (anon)</button>
        </div>

        {err && (
          <div className="hd-card" style={{ padding: 10, marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        <div className="hd-card">
          <table className="hd-table">
            <thead>
              <tr>
                <th>시각</th><th>유형</th><th>Segment</th><th>NPS</th>
                <th>언어</th><th>수신</th><th>옵트인</th><th>발신</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="hd-num">{r.captured_at.slice(11, 19)} · {r.captured_at.slice(0, 10)}</td>
                  <td><RespBadge value={r.respondent_type} /></td>
                  <td><SegBadge value={r.segment} /></td>
                  <td className="hd-num"><NpsCell value={r.nps} /></td>
                  <td>{r.language ?? '–'}</td>
                  <td>{r.future_subscription ? <span className="hd-badge green">✓</span> : <span className="hd-badge ghost">–</span>}</td>
                  <td>{r.contact_opted_in ? <span className="hd-badge blue">opt-in</span> : <span className="hd-badge ghost">anon</span>}</td>
                  <td className="hd-num">{r.dealer_id ?? (r.device_id ? r.device_id.slice(0, 8) : '–')}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:24 }} className="hd-meta">데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button className="hd-btn" disabled={!cursor || loading} onClick={() => fetchPage(true)}>
            {loading ? '로딩…' : cursor ? '더 보기' : '끝'}
          </button>
          <span className="hd-meta" style={{ marginLeft: 'auto' }}>{rows.length}건</span>
        </div>
      </main>
    </>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <span className={`hd-snav ${active ? 'active' : ''}`} onClick={onClick}
      style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 12 }}>
      {children}
    </span>
  );
}

function inputStyle(w: number): React.CSSProperties {
  return {
    width: w, height: 28, padding: '0 8px',
    border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
    font: 'inherit', fontSize: 12,
  };
}

function RespBadge({ value }: { value: 'dealer' | 'visitor' }) {
  return <span className={`hd-badge ${value === 'dealer' ? 'accent' : 'blue'}`}>{value}</span>;
}

function SegBadge({ value }: { value: string | null }) {
  if (!value) return <span className="hd-meta">–</span>;
  const tone =
    value === 'key_account' || value === 'mining' ? 'green'
    : value === 'rental' ? 'amber'
    : 'blue';
  return <span className={`hd-badge ${tone}`}>{value}</span>;
}

function NpsCell({ value }: { value: number | null }) {
  if (value == null) return <span className="hd-meta">–</span>;
  const color = value >= 9 ? 'var(--hd-prosperity)' : value >= 7 ? 'var(--hd-amber)' : 'var(--hd-red)';
  return <span style={{ color, fontWeight: 600 }}>{value}</span>;
}
