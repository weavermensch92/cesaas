'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AuthGate } from '../../../components/AuthGate';
import { TopBar } from '../../../components/TopBar';
import { SectionNav } from '../../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import { getVoiceResponseDetail, type VoiceResponseDetail } from '@/lib/api';

const LANG_KEYS = ['original', 'ko', 'en', 'ru'] as const;
type LangKey = typeof LANG_KEYS[number];

export default function VoiceResponseDetailPage() {
  return (
    <AuthGate>
      {({ session: s }) => <View email={s.user.email ?? ''} />}
    </AuthGate>
  );
}

function View({ email }: { email: string }) {
  const params = useParams<{ id: string }>();
  const id = (params?.id as string) ?? '';
  const [data, setData] = useState<VoiceResponseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true); setErr(null);
    try { setData(await getVoiceResponseDetail(id)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);
  const signOut = () => getSupabase().auth.signOut();

  return (
    <>
      <TopBar lang={'ko'} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
          <Link href="/voice/responses" className="hd-meta" style={{ textDecoration: 'none' }}>← 목록</Link>
          <h1 className="hd-h1" style={{ margin: 0 }}>응답 detail</h1>
          {data?.response && (
            <span className="hd-meta" style={{ fontFamily: 'monospace', fontSize: 11 }}>{data.response.id}</span>
          )}
          <span style={{ marginLeft: 'auto' }} />
          <button className="hd-btn ghost sm" onClick={reload} disabled={loading}>
            {loading ? '...' : '↻'}
          </button>
        </div>

        {err && <div className="hd-card" style={{ padding: 12, color: '#B91C1C', marginBottom: 10 }}>{err}</div>}

        {data && (
          <>
            <ResponseHeader r={data.response} />
            <AnswersTable answers={data.answers} responseLang={data.response.language} />
          </>
        )}
      </main>
    </>
  );
}

function ResponseHeader({ r }: { r: VoiceResponseDetail['response'] }) {
  return (
    <div className="hd-card" style={{ padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <Field label="시각" value={`${r.captured_at.slice(11, 19)} · ${r.captured_at.slice(0, 10)}`} />
      <Field label="유형" value={r.respondent_type} />
      <Field label="딜러/디바이스" value={r.dealer_id ?? r.device_id?.slice(0, 12) ?? '–'} />
      <Field label="Survey" value={r.survey_id} mono />
      <Field label="Event" value={r.event ?? '–'} />
      <Field label="Segment" value={r.segment ? `${r.segment} (${r.segment_confidence?.toFixed(2) ?? '?'})` : '–'} />
      <Field label="NPS" value={r.nps == null ? '–' : String(r.nps)} />
      <Field label="회사" value={r.target_company ?? '–'} />
      <Field label="담당자" value={`${r.contact_name ?? '–'}${r.contact_phone ? ` · ${r.contact_phone}` : ''}`} />
      <Field label="언어" value={r.language} />
      <Field label="옵트인" value={r.contact_opted_in ? '✓' : '–'} />
      <Field label="번역 상태" value={
        <TranslationsStatusBadge status={r.translations_status} />
      } />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="hd-eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 13, fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  );
}

function TranslationsStatusBadge({ status }: { status: VoiceResponseDetail['response']['translations_status'] }) {
  if (!status || status === 'none') return <span className="hd-badge ghost">none</span>;
  const bg = status === 'done' ? 'green' : status === 'partial' ? 'blue' : 'amber';
  return <span className={`hd-badge ${bg}`}>{status}</span>;
}

function AnswersTable({ answers, responseLang }: {
  answers: VoiceResponseDetail['answers'];
  responseLang: string;
}) {
  return (
    <div className="hd-card" style={{ padding: 12 }}>
      <h2 className="hd-h2" style={{ margin: '0 0 10px' }}>답변 ({answers.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th(60)}>#</th>
            <th style={th(280)}>질문</th>
            <th style={th()}>답변 / 번역</th>
          </tr>
        </thead>
        <tbody>
          {answers.map((a, i) => (
            <AnswerRow key={a.question_id} idx={i + 1} a={a} responseLang={responseLang} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnswerRow({ idx, a, responseLang }: {
  idx: number;
  a: VoiceResponseDetail['answers'][number];
  responseLang: string;
}) {
  return (
    <tr style={{ borderTop: '1px solid var(--hd-steel-100, #EEF1F4)' }}>
      <td style={{ padding: '10px 6px', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', color: 'var(--hd-gray)' }}>{idx}</td>
      <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title.ko ?? a.title.ru}</div>
        <div className="hd-meta" style={{ fontSize: 11 }}>{a.title.ru}</div>
        <div className="hd-meta" style={{ fontSize: 10, marginTop: 4, display: 'flex', gap: 6 }}>
          <span style={{ fontFamily: 'monospace' }}>{a.question_id}</span>
          <span className="hd-badge ghost" style={{ fontSize: 9 }}>{a.type}</span>
          {a.axis && <span className="hd-badge blue" style={{ fontSize: 9 }}>{a.axis}</span>}
        </div>
      </td>
      <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
        <AnswerValue a={a} responseLang={responseLang} />
      </td>
    </tr>
  );
}

function AnswerValue({ a, responseLang }: {
  a: VoiceResponseDetail['answers'][number];
  responseLang: string;
}) {
  const [tab, setTab] = useState<LangKey>('original');
  const hasTranslations = !!a.translations;

  // 자유 텍스트인지 (text_short/text_long 또는 {other_text}·{text} 구조)
  const freeText = extractFreeText(a.answer);
  const showTabs = !!freeText && hasTranslations;

  if (showTabs && a.translations) {
    const value = tab === 'original' ? freeText : a.translations[tab];
    return (
      <div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(LANG_KEYS as readonly LangKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`hd-btn ${tab === k ? '' : 'ghost'} sm`}
              style={{ padding: '2px 8px', fontSize: 11 }}
            >
              {k === 'original' ? `원문(${responseLang})` : k.toUpperCase()}
            </button>
          ))}
          <span style={{ marginLeft: 'auto' }} />
          {a.translation_status && (
            <span className={`hd-badge ${a.translation_status === 'done' ? 'green' : a.translation_status === 'failed' ? 'red' : 'amber'}`} style={{ fontSize: 9 }}>
              {a.translation_status}
            </span>
          )}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, padding: 8, background: 'var(--hd-steel-50, #F5F7F9)', borderRadius: 4 }}>
          {value || <span className="hd-meta">–</span>}
        </div>
      </div>
    );
  }

  if (freeText) {
    return (
      <div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, padding: 8, background: 'var(--hd-steel-50, #F5F7F9)', borderRadius: 4 }}>
          {freeText}
        </div>
        {a.translation_status && a.translation_status !== 'done' && (
          <div style={{ marginTop: 4 }}>
            <span className={`hd-badge ${a.translation_status === 'failed' ? 'red' : 'amber'}`} style={{ fontSize: 9 }}>
              번역 {a.translation_status}
            </span>
          </div>
        )}
      </div>
    );
  }

  // 구조화 답변
  return <PrettyAnswer answer={a.answer} options={a.options} type={a.type} />;
}

function PrettyAnswer({ answer, options, type }: { answer: unknown; options: unknown; type: string }) {
  if (answer === null || answer === undefined) return <span className="hd-meta">–</span>;

  // multi_select (배열)
  if (Array.isArray(answer)) {
    const opts = Array.isArray(options) ? options as Array<Record<string, unknown>> : [];
    const labels = answer.map((v) => {
      const o = opts.find((opt) => opt.value === v);
      return (o?.label_ko as string | undefined) ?? (o?.label_ru as string | undefined) ?? String(v);
    });
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {labels.map((l, i) => (
          <span key={i} className="hd-badge blue" style={{ fontSize: 11 }}>
            {Array.isArray(answer) && answer.length > 1 ? `${i + 1}. ${l}` : l}
          </span>
        ))}
      </div>
    );
  }

  // {choice, other_text} (계층 single_select)
  if (typeof answer === 'object' && 'choice' in (answer as Record<string, unknown>)) {
    const o = answer as { choice?: string; other_text?: string };
    const opts = Array.isArray(options) ? options as Array<Record<string, unknown>> : [];
    const opt = opts.find((x) => x.value === o.choice);
    const label = (opt?.label_ko as string | undefined) ?? (opt?.label_ru as string | undefined) ?? o.choice;
    return (
      <div>
        <span className="hd-badge blue" style={{ fontSize: 11 }}>{label}</span>
        {o.other_text && (
          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', fontSize: 12, padding: 6, background: 'var(--hd-steel-50, #F5F7F9)', borderRadius: 4 }}>
            {o.other_text}
          </div>
        )}
      </div>
    );
  }

  // single_select 또는 scale
  if (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean') {
    const opts = Array.isArray(options) ? options as Array<Record<string, unknown>> : [];
    const opt = opts.find((x) => x.value === answer || x.value === String(answer));
    if (opt) {
      const label = (opt.label_ko as string | undefined) ?? (opt.label_ru as string | undefined) ?? String(answer);
      return <span className="hd-badge blue" style={{ fontSize: 11 }}>{label}</span>;
    }
    if (type === 'scale_1_5' || type === 'scale_1_10' || type === 'nps' || type === 'number') {
      return <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{String(answer)}</span>;
    }
    if (type === 'consent') {
      return answer === true ? <span className="hd-badge green">✓</span> : <span className="hd-badge ghost">–</span>;
    }
    return <span>{String(answer)}</span>;
  }

  return <code style={{ fontSize: 11 }}>{JSON.stringify(answer)}</code>;
}

function extractFreeText(answer: unknown): string | null {
  if (typeof answer === 'string') {
    const t = answer.trim();
    return t.length > 0 ? t : null;
  }
  if (answer && typeof answer === 'object') {
    const o = answer as Record<string, unknown>;
    if (typeof o.other_text === 'string' && o.other_text.trim().length > 0) return o.other_text.trim();
    if (typeof o.text === 'string' && o.text.trim().length > 0) return o.text.trim();
  }
  return null;
}

function th(minWidth?: number): React.CSSProperties {
  return {
    padding: '8px 6px', textAlign: 'left',
    fontSize: 11, color: 'var(--hd-gray)', fontWeight: 600,
    borderBottom: '1px solid var(--hd-steel-200, #ccd2d8)',
    minWidth,
  };
}
