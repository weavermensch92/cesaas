'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import { getLead, type LeadDetail } from '@/lib/api';

const LANG: Lang = 'ko';

export default function LeadPage({ params }: { params: { id: string } }) {
  return (
    <AuthGate>{(s) => <View id={params.id} email={s.user.email ?? ''} />}</AuthGate>
  );
}

function View({ id, email }: { id: string; email: string }) {
  const _t = makeT(LANG);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setDetail(await getLead(id)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  const signOut = () => getSupabase().auth.signOut();

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />
      <div className="hd-subnav">
        <Link href="/leads" className="hd-snav">← Leads</Link>
        <span className="hd-snav active">상세</span>
      </div>

      <main style={{ padding: 18 }}>
        {err && (
          <div className="hd-card" style={{ padding: 10, marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}
        {!detail && loading && <div className="hd-meta">로딩 중…</div>}
        {detail && <Detail detail={detail} />}
      </main>
    </>
  );
}

function Detail({ detail }: { detail: LeadDetail }) {
  const { lead, clusters, responses, normalized, dealer_output, links } = detail;
  return (
    <>
      <h1 className="hd-h1" style={{ margin: '6px 0 4px' }}>
        {lead.company_name ?? lead.contact_name ?? `Lead ${lead.id.slice(0, 8)}`}
      </h1>
      <p className="hd-meta" style={{ margin: '0 0 14px' }}>
        entity_id {lead.entity_id ?? <em>unassociated</em>} · {lead.crm_id} · 최근 {lead.last_seen_at.slice(0, 16).replace('T', ' ')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 14 }}>
        <KPI label="Score"    value={lead.score ?? '–'} sub={lead.score_at?.slice(5, 16).replace('T', ' ')} accent={lead.score != null && lead.score >= 85 ? 'red' : lead.score != null && lead.score >= 70 ? 'amber' : 'trust'} />
        <KPI label="Priority" value={lead.priority ?? '–'} accent="trust" />
        <KPI label="Segment"  value={lead.segment ?? '–'} />
        <KPI label="채널"     value={`S ${lead.sensor_count} · V ${lead.voice_count}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section className="hd-card">
          <div className="hd-card-hd"><span className="hd-card-title">메타·요약</span></div>
          <Field label="회사명"     value={lead.company_name} />
          <Field label="담당자"     value={lead.contact_name} />
          <Field label="연락처"     value={lead.contact_phone} />
          <Field label="금액"       value={lead.amount != null ? `${lead.amount.toLocaleString()} ${lead.currency ?? ''}` : null} />
          <Field label="단계"       value={lead.stage} />
          <Field label="관심 장비"  value={lead.product_model} />
          <Field label="첫 등록"    value={lead.first_seen_at.slice(0, 16).replace('T', ' ')} />
          <Field label="최근 활동"  value={lead.last_seen_at.slice(0, 16).replace('T', ' ')} />
        </section>

        <section className="hd-card">
          <div className="hd-card-hd">
            <span className="hd-card-title">Dealer Playbook (R_10.07)</span>
            {dealer_output && <span className="hd-card-sub">rule {dealer_output.rule_version} · {dealer_output.created_at.slice(0, 16).replace('T', ' ')}</span>}
          </div>
          {dealer_output ? (
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <span className={`hd-badge ${dealer_output.priority === 'P1' ? 'red' : dealer_output.priority === 'P2' ? 'amber' : 'green'}`} style={{ fontWeight: 700 }}>{dealer_output.priority}</span>
                <span className="hd-badge accent">{dealer_output.segment}</span>
                {dealer_output.score_snapshot != null && (
                  <span className="hd-badge ghost">score {dealer_output.score_snapshot}</span>
                )}
              </div>
              <div style={{ font: '600 16px var(--hd-font-display)', color: 'var(--hd-trust)' }}>
                {dealer_output.title ?? '–'}
              </div>
              <p className="hd-meta" style={{ marginTop: 8 }}>
                풀 텍스트는 클라이언트(R_10.07 YAML) — 본 페이지는 segment·priority 기록만.
              </p>
            </div>
          ) : (
            <div style={{ padding: 14 }} className="hd-meta">
              아직 발급 안 됨 — score / segment 결정 후 자동 생성.
            </div>
          )}
        </section>

        {normalized && (
          <section className="hd-card" style={{ gridColumn: '1 / -1' }}>
            <div className="hd-card-hd"><span className="hd-card-title">Sensor · 13 필드 (latest active)</span></div>
            <div style={{ padding: 8 }}>
              <table className="hd-table">
                <tbody>
                  {NF_KEYS.map((k) => (
                    <tr key={k}>
                      <td style={{ width: 180 }} className="hd-meta">{k}</td>
                      <td className="hd-num">{nfValue(normalized, k)}</td>
                      <td className="hd-meta">
                        {nfConf(normalized, k) != null && (
                          <span style={{ color: nfConf(normalized, k)! >= 0.85 ? 'var(--hd-prosperity)' : nfConf(normalized, k)! >= 0.7 ? 'var(--hd-amber)' : 'var(--hd-red)' }}>
                            {Math.round((nfConf(normalized, k) as number) * 100)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="hd-card">
          <div className="hd-card-hd">
            <span className="hd-card-title">Sensor 클러스터 · {clusters.length}</span>
          </div>
          <table className="hd-table">
            <thead><tr><th>cluster</th><th>이미지</th><th>상태</th><th>최근</th></tr></thead>
            <tbody>
              {clusters.length === 0 ? (
                <tr><td colSpan={4} className="hd-meta" style={{ textAlign:'center', padding:14 }}>없음</td></tr>
              ) : clusters.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clusters/${c.id}`} className="hd-link">{c.id.slice(0, 8)}</Link></td>
                  <td className="hd-num">{c.image_count}</td>
                  <td><span className={`hd-badge ${c.status === 'normalized' ? 'green' : 'blue'}`}>{c.status}</span></td>
                  <td className="hd-num">{c.updated_at.slice(5, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="hd-card">
          <div className="hd-card-hd">
            <span className="hd-card-title">Voice 응답 · {responses.length}</span>
          </div>
          <table className="hd-table">
            <thead><tr><th>유형</th><th>NPS</th><th>seg</th><th>opt-in</th><th>시각</th></tr></thead>
            <tbody>
              {responses.length === 0 ? (
                <tr><td colSpan={5} className="hd-meta" style={{ textAlign:'center', padding:14 }}>없음</td></tr>
              ) : responses.map((r) => (
                <tr key={r.id}>
                  <td><span className={`hd-badge ${r.respondent_type === 'dealer' ? 'accent' : 'blue'}`}>{r.respondent_type}</span></td>
                  <td className="hd-num">{r.nps ?? '–'}</td>
                  <td>{r.segment ?? '–'}</td>
                  <td>{r.contact_opted_in ? <span className="hd-badge blue">opt-in</span> : <span className="hd-badge ghost">anon</span>}</td>
                  <td className="hd-num">{r.captured_at.slice(5, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {links.length > 0 && (
          <section className="hd-card" style={{ gridColumn: '1 / -1' }}>
            <div className="hd-card-hd"><span className="hd-card-title">Linkage 이력 · {links.length}</span></div>
            <table className="hd-table">
              <thead><tr><th>시각</th><th>소스</th><th>source_id</th></tr></thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id}>
                    <td className="hd-num">{l.linked_at.slice(0, 19).replace('T', ' ')}</td>
                    <td><span className="hd-badge ghost">{l.source_table}</span></td>
                    <td className="hd-num">{l.source_id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}

const NF_KEYS = [
  'deal_id', 'deal_code', 'company_name', 'contact_name', 'contact_phone',
  'contact_email', 'amount', 'currency', 'stage', 'product_model',
  'region', 'date_created', 'responsible_dealer',
] as const;

function nfValue(nf: Record<string, unknown>, k: string): string {
  const v = nf[k];
  if (v == null || v === '') return '–';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}
function nfConf(nf: Record<string, unknown>, k: string): number | null {
  if (k === 'currency') return null;
  const v = nf[`${k}_confidence`];
  return typeof v === 'number' ? v : null;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="hd-field">
      <span className="hd-field-label">{label}</span>
      <span className={`hd-field-val ${value == null ? 'muted' : ''}`}>{value == null ? '–' : String(value)}</span>
      <span />
    </div>
  );
}

function KPI({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: 'red'|'amber'|'trust' }) {
  const color = accent === 'red' ? 'var(--hd-red)' : accent === 'amber' ? 'var(--hd-amber)' : 'var(--hd-trust)';
  return (
    <div className="hd-card" style={{ padding: 14 }}>
      <div className="hd-eyebrow">{label}</div>
      <div style={{ font: '700 26px var(--hd-font-display)', color, marginTop: 6 }}>{value}</div>
      {sub && <div className="hd-meta" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
