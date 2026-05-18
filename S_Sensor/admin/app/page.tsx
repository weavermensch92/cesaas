'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from './components/AuthGate';
import { TopBar } from './components/TopBar';
import { SectionNav } from './components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  listCaptures,
  type CaptureListFilters,
  type CaptureListItem,
} from '@/lib/api';

const LANG: Lang = 'ko';

export default function CapturesPage() {
  return (
    <AuthGate>
      {(session) => <CapturesView email={session.user.email ?? ''} />}
    </AuthGate>
  );
}

function CapturesView({ email }: { email: string }) {
  const t = makeT(LANG);
  const [filters, setFilters] = useState<CaptureListFilters>({ limit: 50 });
  const [rows, setRows] = useState<CaptureListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchPage = useCallback(async (append: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      const page = await listCaptures({
        ...filters,
        cursor: append ? cursor : null,
      });
      setRows((prev) => append ? [...prev, ...page.data] : page.data);
      setCursor(page.next_cursor);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filters, cursor]);

  useEffect(() => { fetchPage(false).catch(() => {}); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filters]);

  const signOut = () => { getSupabase().auth.signOut(); };

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <div className="hd-subnav">
        <span className="hd-snav active">{t('nav_captures')}</span>
        <FilterChip label={t('sub_all')}        active={!filters.status}
          onClick={() => setFilters({ ...filters, status: undefined })} />
        <FilterChip label={t('sub_unreviewed')} active={filters.status === 'clustered,classified'}
          onClick={() => setFilters({ ...filters, status: 'clustered,classified' })} />
        <FilterChip label={t('sub_low_conf')}   active={filters.status === 'low'}
          onClick={() => setFilters({ ...filters, status: 'normalized' })} />
        <FilterChip label={t('sub_failed')}     active={filters.status === 'failed'}
          onClick={() => setFilters({ ...filters, status: 'failed' })} />
      </div>

      <main style={{ padding: 18 }}>
        {err && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-red)', marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        <div className="hd-card">
          <table className="hd-table">
            <thead>
              <tr>
                <th>{t('th_captured')}</th>
                <th>{t('th_dealer')}</th>
                <th>CRM</th>
                <th>{t('th_screen_kinds')}</th>
                <th>{t('th_entity')}</th>
                <th>{t('th_status')}</th>
                <th>분류 신뢰</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="hd-num">{r.captured_at.slice(11, 19)} · {r.captured_at.slice(0, 10)}</td>
                  <td>{r.dealer_id}</td>
                  <td>{r.crm_id}</td>
                  <td>{r.screen_type ?? '–'}</td>
                  <td className="hd-num">{r.entity_id ?? '–'}</td>
                  <td><StatusBadge value={r.status} /></td>
                  <td><Confidence value={r.classification_confidence} /></td>
                  <td>
                    {r.entity_id && (
                      <Link href={`/clusters/${encodeURIComponent(r.entity_id)}/?crm=${r.crm_id}`} className="hd-link">
                        {t('btn_open')}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24 }} className="hd-meta">데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button
            className="hd-btn"
            disabled={!cursor || loading}
            onClick={() => fetchPage(true)}
          >
            {loading ? '로딩…' : cursor ? '더 보기' : '끝'}
          </button>
          <span className="hd-meta" style={{ marginLeft: 'auto' }}>{rows.length}건</span>
        </div>
      </main>
    </>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <span className={`hd-snav ${active ? 'active' : ''}`} onClick={onClick} style={{ cursor: 'pointer' }}>
      {label}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  const tone = value === 'normalized' ? 'green'
    : value === 'classified' || value === 'clustered' ? 'blue'
    : value === 'failed' ? 'red'
    : 'ghost';
  return <span className={`hd-badge ${tone}`}>{value}</span>;
}

function Confidence({ value }: { value: number | null }) {
  if (value == null) return <span className="hd-meta">–</span>;
  const tier = value >= 0.85 ? 'high' : value >= 0.7 ? 'mid' : 'low';
  const pct = Math.round(value * 100);
  return (
    <span className={`hd-conf ${tier}`}>
      <span className="hd-conf-track">
        <span className="hd-conf-fill" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}
