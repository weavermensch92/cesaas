'use client';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  ApiClientError,
  listDealerTokens,
  issueDealerToken,
  revokeDealerToken,
  type DealerTokenRow,
  type DealerTokenIssueResult,
  type DealerTokenListFilters,
} from '@/lib/api';

const LANG: Lang = 'ko';
const DEFAULT_EVENT = 'ctt_moscow_2026';

export default function VoiceDealersPage() {
  return (
    <AuthGate>
      {({ session }) => <View email={session.user.email ?? ''} />}
    </AuthGate>
  );
}

function View({ email }: { email: string }) {
  const t = makeT(LANG);
  const [filters, setFilters] = useState<DealerTokenListFilters>({ limit: 50 });
  const [rows, setRows] = useState<DealerTokenRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Issue form
  const [dealerId, setDealerId] = useState('');
  const [event, setEvent] = useState(DEFAULT_EVENT);
  const [ttl, setTtl] = useState(24);
  const [label, setLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<DealerTokenIssueResult | null>(null);

  // QR modal — for issued token or list re-render
  const [showJti, setShowJti] = useState<string | null>(null);

  const fetchPage = useCallback(async (append: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      const page = await listDealerTokens({ ...filters, cursor: append ? cursor : null });
      setRows((prev) => append ? [...prev, ...page.data] : page.data);
      setCursor(page.next_cursor);
    } catch (e) {
      setErr(extractError(e));
    } finally {
      setLoading(false);
    }
  }, [filters, cursor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPage(false).catch(() => {}); }, [filters]);

  const signOut = () => getSupabase().auth.signOut();

  const onIssue = async () => {
    setIssuing(true); setErr(null); setIssued(null);
    try {
      const result = await issueDealerToken({
        dealer_id: dealerId.trim(),
        event: event.trim(),
        ttl_hours: ttl,
        label: label.trim() || undefined,
      });
      setIssued(result);
      setDealerId(''); setLabel('');
      await fetchPage(false);
    } catch (e) {
      setErr(extractError(e));
    } finally {
      setIssuing(false);
    }
  };

  const onRevoke = async (jti: string) => {
    if (!confirm(`토큰을 폐기하시겠습니까?\njti: ${jti.slice(0, 8)}…`)) return;
    try {
      await revokeDealerToken(jti);
      await fetchPage(false);
    } catch (e) {
      setErr(extractError(e));
    }
  };

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <h1 className="hd-h1" style={{ margin: '6px 0 6px' }}>{t('product')} · Dealer 계정</h1>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>
          V_30.04 · Admin이 딜러별 Bearer JWT를 발급. 딜러는 QR/URL로 접속하면 dealer.html이 자동 인증되어 인터뷰 입력 가능.
        </p>

        {err && (
          <div className="hd-card" style={{ padding: 10, marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        {/* Issue form */}
        <div className="hd-card" style={{ marginBottom: 12, padding: 14 }}>
          <div className="hd-eyebrow" style={{ marginBottom: 8 }}>새 토큰 발급</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Labeled label="dealer_id">
              <input value={dealerId} onChange={(e) => setDealerId(e.target.value)}
                placeholder="dealer_001" style={inputStyle(140)} />
            </Labeled>
            <Labeled label="event">
              <input value={event} onChange={(e) => setEvent(e.target.value)}
                placeholder="ctt_moscow_2026" style={inputStyle(180)} />
            </Labeled>
            <Labeled label="TTL(h)">
              <input type="number" min={1} max={720} value={ttl}
                onChange={(e) => setTtl(Number(e.target.value) || 24)} style={inputStyle(72)} />
            </Labeled>
            <Labeled label="라벨">
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="부스 B-3 안드레이" style={inputStyle(220)} />
            </Labeled>
            <button className="hd-btn primary" disabled={issuing || !dealerId.trim() || !event.trim()}
              onClick={onIssue}>
              {issuing ? '발급 중…' : '발급'}
            </button>
          </div>
        </div>

        {/* Just-issued result */}
        {issued && (
          <IssuedResultCard issued={issued} onClose={() => setIssued(null)} />
        )}

        {/* Filter bar */}
        <div className="hd-card" style={{ marginBottom: 12, padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hd-eyebrow">이벤트</span>
          <input value={filters.event ?? ''} onChange={(e) => setFilters({ ...filters, event: e.target.value || undefined })}
            placeholder="전체" style={inputStyle(180)} />
          <Chip active={!!filters.include_revoked}
            onClick={() => setFilters({ ...filters, include_revoked: !filters.include_revoked })}>
            폐기 포함
          </Chip>
          <Chip active={!!filters.include_expired}
            onClick={() => setFilters({ ...filters, include_expired: !filters.include_expired })}>
            만료 포함
          </Chip>
          <span className="hd-meta" style={{ marginLeft: 'auto' }}>{rows.length}건</span>
        </div>

        {/* Token list */}
        <div className="hd-card">
          <table className="hd-table">
            <thead>
              <tr>
                <th>발급 시각</th>
                <th>dealer_id</th>
                <th>event</th>
                <th>라벨</th>
                <th>응답 수</th>
                <th>만료</th>
                <th>상태</th>
                <th>발급자</th>
                <th style={{ textAlign: 'right' }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="hd-num">{formatTs(r.issued_at)}</td>
                  <td><code>{r.dealer_id}</code></td>
                  <td className="hd-meta">{r.event}</td>
                  <td>{r.label ?? <span className="hd-meta">–</span>}</td>
                  <td className="hd-num">
                    {r.response_count > 0
                      ? <span className="hd-badge accent">{r.response_count}</span>
                      : <span className="hd-meta">0</span>}
                  </td>
                  <td className="hd-num">{formatTs(r.expires_at)}</td>
                  <td><StatusBadge row={r} /></td>
                  <td className="hd-meta">{r.issued_by ?? <span className="hd-meta">CLI</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.revoked_at ? (
                      <span className="hd-meta">–</span>
                    ) : (
                      <button className="hd-btn ghost sm" onClick={() => onRevoke(r.jti)}>폐기</button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 24 }} className="hd-meta">
                    발급된 토큰 없음 — 위 폼으로 발급
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button className="hd-btn" disabled={!cursor || loading} onClick={() => fetchPage(true)}>
            {loading ? '로딩…' : cursor ? '더 보기' : '끝'}
          </button>
        </div>

        <p className="hd-meta" style={{ marginTop: 18 }}>
          ※ JWT/URL은 발급 직후 한 번만 확인 가능합니다. 닫으면 회수 불가 — 분실 시 폐기 후 재발급.
        </p>
      </main>
    </>
  );
}

function IssuedResultCard({ issued, onClose }: { issued: DealerTokenIssueResult; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(issued.url, { width: 320, margin: 2, color: { dark: '#002554', light: '#ffffff' } })
      .then((u) => { if (!cancelled) setQrDataUrl(u); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [issued.url]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1200); }
    catch { /* clipboard 권한 없음 */ }
  };

  return (
    <div className="hd-card" style={{ marginBottom: 12, padding: 14, borderColor: 'var(--hd-prosperity)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="hd-eyebrow" style={{ color: 'var(--hd-prosperity)' }}>발급 완료 — 딜러에게 QR/URL 전달</div>
        <button className="hd-btn ghost sm" onClick={onClose}>닫기</button>
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 auto' }}>
          {qrDataUrl
            ? <img src={qrDataUrl} alt="dealer QR" style={{ width: 220, height: 220, border: 'var(--hd-border)' }} />
            : <div className="hd-meta" style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>QR 생성 중…</div>}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Field label="dealer_id"><code>{issued.dealer_id}</code></Field>
          <Field label="event"><code>{issued.event}</code></Field>
          <Field label="만료"><span className="hd-num">{formatTs(issued.expires_at)}</span></Field>
          <Field label="URL">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={issued.url} readOnly style={{ ...inputStyle(0), flex: 1, fontFamily: 'var(--hd-mono, monospace)', fontSize: 12 }} />
              <button className="hd-btn sm" onClick={() => copy(issued.url)}>{copiedUrl ? '복사됨' : '복사'}</button>
            </div>
          </Field>
          <Field label="jti"><code className="hd-meta">{issued.jti}</code></Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span className="hd-eyebrow" style={{ minWidth: 64, fontSize: 11 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="hd-eyebrow" style={{ fontSize: 11 }}>{label}</span>
      {children}
    </label>
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

function StatusBadge({ row }: { row: DealerTokenRow }) {
  if (row.revoked_at) return <span className="hd-badge ghost">폐기</span>;
  if (new Date(row.expires_at).getTime() < Date.now()) return <span className="hd-badge amber">만료</span>;
  return <span className="hd-badge green">유효</span>;
}

function inputStyle(w: number): React.CSSProperties {
  return {
    width: w > 0 ? w : undefined,
    height: 28, padding: '0 8px',
    border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
    font: 'inherit', fontSize: 13,
  };
}

function formatTs(iso: string): string {
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
}

function extractError(e: unknown): string {
  if (e instanceof ApiClientError) {
    const b = e.body as Record<string, unknown> | string;
    if (typeof b === 'object' && b && 'message' in b) return String((b as Record<string, unknown>).message);
    return typeof b === 'string' ? b : `HTTP ${e.status}`;
  }
  return e instanceof Error ? e.message : String(e);
}
