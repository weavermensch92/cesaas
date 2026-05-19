'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import { listLeads, type LeadFilters, type LeadRow } from '@/lib/api';

const LANG: Lang = 'ko';

export default function LeadsPage() {
  return (
    <AuthGate>{({ session: s }) => <View email={s.user.email ?? ''} />}</AuthGate>
  );
}

function View({ email }: { email: string }) {
  const _t = makeT(LANG);
  const [filters, setFilters] = useState<LeadFilters>({ limit: 50 });
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const fetchPage = useCallback(async (append: boolean) => {
    setLoading(true); setErr(null);
    try {
      const page = await listLeads({ ...filters, cursor: append ? cursor : null });
      setRows((prev) => append ? [...prev, ...page.data] : page.data);
      setCursor(page.next_cursor);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [filters, cursor]);

  useEffect(() => { fetchPage(false).catch(() => {}); /* eslint-disable-line */ }, [filters]);

  const signOut = () => getSupabase().auth.signOut();

  const setPrio = (p: string | undefined) => setFilters({ ...filters, priority: p });
  const setChan = (kind: 'both' | 'sensor' | 'voice' | 'all') => {
    if (kind === 'sensor') setFilters({ ...filters, has_sensor: 'true', has_voice: undefined });
    else if (kind === 'voice') setFilters({ ...filters, has_sensor: undefined, has_voice: 'true' });
    else if (kind === 'both') setFilters({ ...filters, has_sensor: 'true', has_voice: 'true' });
    else setFilters({ ...filters, has_sensor: undefined, has_voice: undefined });
  };
  const chanActive = filters.has_sensor === 'true' && filters.has_voice === 'true' ? 'both'
    : filters.has_sensor === 'true' ? 'sensor'
    : filters.has_voice === 'true' ? 'voice'
    : 'all';
  const toggleUnassoc = () => setFilters({
    ...filters,
    unassociated: filters.unassociated === 'true' ? undefined : 'true',
  });

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <h1 className="hd-h1" style={{ margin: '6px 0 6px' }}>Leads · U_Unified</h1>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>
          Sensor + Voice 응집 · R_10.01 LeadScoring · R_10.07 Playbook · H_채널통합 가설
        </p>

        <div className="hd-card" style={{ marginBottom: 12, padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className="hd-eyebrow">Priority</span>
          <Chip active={!filters.priority} onClick={() => setPrio(undefined)}>All</Chip>
          <Chip active={filters.priority === 'P1'} onClick={() => setPrio('P1')}>P1</Chip>
          <Chip active={filters.priority === 'P2'} onClick={() => setPrio('P2')}>P2</Chip>
          <Chip active={filters.priority === 'P1,P2'} onClick={() => setPrio('P1,P2')}>P1+P2</Chip>

          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />
          <span className="hd-eyebrow">채널</span>
          <Chip active={chanActive === 'all'}    onClick={() => setChan('all')}>All</Chip>
          <Chip active={chanActive === 'both'}   onClick={() => setChan('both')}>Sensor + Voice</Chip>
          <Chip active={chanActive === 'sensor'} onClick={() => setChan('sensor')}>Sensor only</Chip>
          <Chip active={chanActive === 'voice'}  onClick={() => setChan('voice')}>Voice only</Chip>

          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />
          <span className="hd-eyebrow">상태</span>
          <Chip active={filters.unassociated === 'true'} onClick={toggleUnassoc}>Unassociated</Chip>

          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setFilters({ ...filters, q: q.length >= 2 ? q : undefined });
            }}
            placeholder="회사명·entity·연락처 (Enter)"
            style={{ height: 28, padding: '0 8px', border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', font: 'inherit', fontSize: 12, minWidth: 220 }}
          />
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
                <th>Prio</th><th>Score</th><th>Segment</th><th>회사</th>
                <th>Entity</th><th>채널</th><th>금액</th><th>단계</th><th>최근</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><PriorityBadge value={r.priority} /></td>
                  <td><ScoreBar value={r.score} /></td>
                  <td><SegBadge value={r.segment} /></td>
                  <td>{r.company_name ?? '–'}</td>
                  <td className="hd-num">{r.entity_id ?? '–'}</td>
                  <td><ChannelDots sensor={r.sensor_count} voice={r.voice_count} /></td>
                  <td className="hd-num">{r.amount != null ? `${formatAmount(r.amount)} ${r.currency ?? ''}` : '–'}</td>
                  <td>{r.stage ?? '–'}</td>
                  <td className="hd-num">{r.last_seen_at.slice(5, 16).replace('T', ' ')}</td>
                  <td><Link href={`/leads/${r.id}`} className="hd-link">열기</Link></td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24 }} className="hd-meta">데이터 없음</td></tr>
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

function formatAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <span className={`hd-snav ${active ? 'active' : ''}`} onClick={onClick}
      style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 12 }}>{children}</span>
  );
}

function PriorityBadge({ value }: { value: LeadRow['priority'] }) {
  if (!value) return <span className="hd-meta">–</span>;
  const tone = value === 'P1' ? 'red'
    : value === 'P2' ? 'amber'
    : value === 'P3' ? 'green'
    : value === 'P4' ? 'blue'
    : 'ghost';
  return <span className={`hd-badge ${tone}`} style={{ fontWeight: 700 }}>{value}</span>;
}

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span className="hd-meta">–</span>;
  const tier = value >= 85 ? 'high' : value >= 70 ? 'mid' : value >= 55 ? 'mid' : 'low';
  return (
    <span className={`hd-conf ${tier}`}>
      <span className="hd-conf-track">
        <span className="hd-conf-fill" style={{ width: `${value}%` }} />
      </span>
      {value}
    </span>
  );
}

function SegBadge({ value }: { value: string | null }) {
  if (!value) return <span className="hd-meta">–</span>;
  const tone = value === 'key_account' || value === 'mining' ? 'green'
    : value === 'rental' ? 'amber' : 'blue';
  return <span className={`hd-badge ${tone}`}>{value}</span>;
}

function ChannelDots({ sensor, voice }: { sensor: number; voice: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
      <span title="Sensor captures" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: sensor > 0 ? 'var(--hd-discovery)' : 'var(--hd-steel-200)' }} />
        <span className="hd-num">{sensor}</span>
      </span>
      <span title="Voice responses" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: voice > 0 ? 'var(--hd-heritage)' : 'var(--hd-steel-200)' }} />
        <span className="hd-num">{voice}</span>
      </span>
    </span>
  );
}
