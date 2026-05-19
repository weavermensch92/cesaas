'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type Lang, makeT } from '@hd/design/i18n';
import { AuthGate } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  editField,
  getCluster,
  getClusterByEntity,
  triggerNormalize,
  type ClusterDetail,
} from '@/lib/api';

const LANG: Lang = 'ko';

const FIELD_LABELS: Record<string, string> = {
  deal_id: 'Deal ID',
  deal_code: 'Deal Code',
  company_name: '회사명',
  contact_name: '담당자',
  contact_phone: '연락처',
  contact_email: '이메일',
  amount: '예상 금액',
  currency: '통화',
  stage: '단계',
  product_model: '관심 장비',
  region: '지역',
  date_created: '생성일',
  responsible_dealer: '담당 딜러',
};

export default function ClusterPage({ params }: { params: { id: string } }) {
  return (
    <AuthGate>
      {({ session }) => (
        <ClusterView idOrEntity={decodeURIComponent(params.id)} email={session.user.email ?? ''} />
      )}
    </AuthGate>
  );
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function ClusterView({ idOrEntity, email }: { idOrEntity: string; email: string }) {
  const t = makeT(LANG);
  const searchParams = useSearchParams();
  const crm = searchParams.get('crm');

  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = isUuid(idOrEntity)
        ? await getCluster(idOrEntity)
        : crm
          ? await getClusterByEntity(idOrEntity, crm)
          : null;
      if (!d) throw new Error('CRM query string 누락 (?crm=...)');
      setDetail(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [idOrEntity, crm]);

  useEffect(() => { reload(); }, [reload]);

  const signOut = () => getSupabase().auth.signOut();

  const onRetrigger = async () => {
    if (!detail) return;
    setTriggering(true);
    try {
      await triggerNormalize({ cluster_id: detail.cluster.id, priority: 'high', reason: 'admin manual' });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering(false);
    }
  };

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />
      <div className="hd-subnav">
        <Link href="/" className="hd-snav">← {t('nav_captures')}</Link>
        <span className="hd-snav active">{t('sec_cluster')}</span>
        <span className="hd-spacer" />
      </div>

      <main style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {err && (
          <div className="hd-card" style={{ gridColumn: '1 / -1', padding: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        {!detail && loading && <div className="hd-meta">로딩중…</div>}

        {detail && (
          <>
            <section className="hd-card">
              <div className="hd-card-hd">
                <span className="hd-card-title">{t('sec_meta')}</span>
                <span className="hd-spacer" />
                <button className="hd-btn accent" onClick={onRetrigger} disabled={triggering}>
                  {triggering ? '예약 중…' : t('btn_reextract')}
                </button>
              </div>
              <div className="hd-field">
                <span className="hd-field-label">Cluster ID</span>
                <span className="hd-field-val hd-num">{detail.cluster.id}</span>
              </div>
              <div className="hd-field">
                <span className="hd-field-label">Entity</span>
                <span className="hd-field-val">{detail.cluster.entity_id} ({detail.cluster.crm_id})</span>
              </div>
              <div className="hd-field">
                <span className="hd-field-label">{t('th_status')}</span>
                <span className="hd-field-val">
                  <span className={`hd-badge ${detail.cluster.status === 'normalized' ? 'green' : 'blue'}`}>
                    {detail.cluster.status}
                  </span>
                </span>
              </div>
              <div className="hd-field">
                <span className="hd-field-label">이미지</span>
                <span className="hd-field-val">{detail.cluster.image_count}장</span>
              </div>
              {detail.normalized && (
                <>
                  <div className="hd-field">
                    <span className="hd-field-label">{t('model')}</span>
                    <span className="hd-field-val">{detail.normalized.model}</span>
                  </div>
                  <div className="hd-field">
                    <span className="hd-field-label">{t('prompt_v')}</span>
                    <span className="hd-field-val">{detail.normalized.prompt_version}</span>
                  </div>
                </>
              )}

              <QueueStatus rows={detail.queue} />
            </section>

            <section className="hd-card">
              <div className="hd-card-hd">
                <span className="hd-card-title">{t('sec_cluster')} · {detail.captures.length}장</span>
              </div>
              <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {detail.captures.map((c) => (
                  <div className="hd-thumb" key={c.id}>
                    {c.image_url
                      ? <img src={c.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span className="hd-meta" style={{ padding: 8 }}>이미지 없음</span>}
                    <span className="hd-thumb-tag">{c.screen_type ?? 'unknown'}</span>
                    <span className="hd-thumb-time">{c.captured_at.slice(11, 16)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="hd-card" style={{ gridColumn: '1 / -1' }}>
              <div className="hd-card-hd">
                <span className="hd-card-title">{t('sec_normalized')}</span>
                {detail.normalized?.edited_by && (
                  <span className="hd-card-sub">최근 편집: {detail.normalized.edited_by} · {detail.normalized.edited_at?.slice(0, 19)}</span>
                )}
              </div>

              {!detail.normalized && (
                <div className="hd-meta" style={{ padding: 14 }}>
                  정규화 결과가 아직 없음. 큐 처리 대기 또는 위 {t('btn_reextract')} 버튼.
                </div>
              )}

              {detail.normalized && (
                <div>
                  {Object.entries(detail.normalized.fields).map(([k, v]) => (
                    <FieldRow
                      key={k}
                      normalizedId={detail.normalized!.id}
                      name={k}
                      label={FIELD_LABELS[k] ?? k}
                      value={v.value}
                      confidence={v.confidence}
                      onEdited={reload}
                    />
                  ))}
                </div>
              )}
            </section>

            {detail.edits.length > 0 && (
              <section className="hd-card" style={{ gridColumn: '1 / -1' }}>
                <div className="hd-card-hd"><span className="hd-card-title">{t('sec_audit')}</span></div>
                <table className="hd-table">
                  <thead>
                    <tr>
                      <th>시각</th><th>필드</th><th>LLM 원본</th><th>편집값</th><th>편집자</th><th>사유</th><th>prompt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.edits.map((e) => (
                      <tr key={e.id}>
                        <td className="hd-num">{e.created_at.slice(0, 19)}</td>
                        <td>{FIELD_LABELS[e.field_name] ?? e.field_name}</td>
                        <td className="hd-num">{e.llm_value ?? '–'}</td>
                        <td className="hd-num">{e.edited_value ?? '∅'}</td>
                        <td>{e.edited_by}</td>
                        <td className="hd-meta">{e.reason ?? '–'}</td>
                        <td className="hd-meta">{e.prompt_version ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function QueueStatus({ rows }: { rows: ClusterDetail['queue'] }) {
  if (rows.length === 0) return null;
  const latest = rows[0];
  if (!latest) return null;
  const tone = latest.status === 'done' ? 'green'
    : latest.status === 'failed' ? 'red'
    : latest.status === 'processing' ? 'amber'
    : 'blue';
  return (
    <div className="hd-field">
      <span className="hd-field-label">정규화 큐</span>
      <span className="hd-field-val">
        <span className={`hd-badge ${tone}`}>{latest.status}</span>{' '}
        <span className="hd-meta">prio {latest.priority} · 시도 {latest.attempts}</span>
        {latest.last_error && (
          <div className="hd-meta" style={{ color: 'var(--hd-red)', marginTop: 4 }}>{latest.last_error}</div>
        )}
      </span>
    </div>
  );
}

function FieldRow({
  normalizedId, name, label, value, confidence, onEdited,
}: {
  normalizedId: string;
  name: string;
  label: string;
  value: unknown;
  confidence: number | null;
  onEdited: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      await editField({
        normalized_id: normalizedId,
        field_name: name,
        new_value: draft === '' ? null : draft,
        reason: 'admin manual',
      });
      setEditing(false);
      onEdited();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hd-field">
      <span className="hd-field-label">{label}</span>
      {editing ? (
        <span className="hd-field-val" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              flex: 1, height: 28, padding: '0 8px',
              border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
              font: 'inherit',
            }}
          />
          <button className="hd-btn primary sm" disabled={saving} onClick={submit}>저장</button>
          <button className="hd-btn sm" disabled={saving} onClick={() => setEditing(false)}>취소</button>
        </span>
      ) : (
        <span className={`hd-field-val ${value == null ? 'muted' : ''}`}>
          {value == null ? '∅' : String(value)}
        </span>
      )}
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {confidence != null && <ConfBar value={confidence} />}
        {!editing && (
          <button className="hd-btn ghost sm" onClick={() => setEditing(true)}>편집</button>
        )}
      </span>
      {err && (
        <span className="hd-meta" style={{ gridColumn: '2 / -1', color: 'var(--hd-red)' }}>{err}</span>
      )}
    </div>
  );
}

function ConfBar({ value }: { value: number }) {
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
