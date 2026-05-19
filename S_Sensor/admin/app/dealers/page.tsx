'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate, isAdminRole } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import type { MeProfile } from '@/lib/api';
import QRCode from 'qrcode';

const LANG: Lang = 'ko';

interface DealerRow {
  dealer_id: string;
  name: string;
  affiliation: string | null;
  region: string | null;
  event: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
}

interface IssueResult {
  dealer_id: string;
  voice_url: string;
  voice_jti: string;
  sensor_key_id: string;
  zip_filename: string;
  qr_data_url: string;   // 클라이언트 생성
}

export default function DealersPage() {
  return <AuthGate>{({ session, me }) => <View email={session.user.email ?? ''} me={me} />}</AuthGate>;
}

function View({ email, me }: { email: string; me: MeProfile }) {
  const signOut = () => { getSupabase().auth.signOut(); };
  const admin = isAdminRole(me.role);

  const [rows, setRows] = useState<DealerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);

  const [form, setForm] = useState({
    dealer_id: '', name: '', affiliation: '',
    region: 'ru', event: 'ctt_moscow_2026',
    contact_email: '', contact_phone: '', notes: '',
  });

  const authedFetch = useCallback(async (init: RequestInit = {}) => {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('not signed in');
    return { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } };
  }, []);

  const refresh = useCallback(async () => {
    if (!admin) return;
    setLoading(true); setErr(null);
    try {
      const init = await authedFetch();
      const r = await fetch('/api/dealers/issue', init);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const d = await r.json();
      setRows(d.data || []);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [admin, authedFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setResult(null);
    try {
      const init = await authedFetch();
      const r = await fetch('/api/dealers/issue', {
        ...init,
        method: 'POST',
        headers: { ...init.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);

      // 메타 헤더 추출
      const voice_url     = r.headers.get('x-hd-voice-url')     || '';
      const voice_jti     = r.headers.get('x-hd-voice-jti')     || '';
      const sensor_key_id = r.headers.get('x-hd-sensor-key-id') || '';
      const dealer_id     = r.headers.get('x-hd-dealer-id')     || form.dealer_id;
      const cd = r.headers.get('content-disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const zip_filename = m?.[1] || `hd-dealer-${dealer_id}.zip`;

      // ZIP 즉시 다운로드
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = zip_filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      // QR 생성
      const qr_data_url = voice_url ? await QRCode.toDataURL(voice_url, { width: 220, margin: 1, color: { dark: '#002554', light: '#ffffff' } }) : '';

      setResult({ dealer_id, voice_url, voice_jti, sensor_key_id, zip_filename, qr_data_url });
      // 폼 일부만 초기화 (event/region 유지)
      setForm((f) => ({ ...f, dealer_id: '', name: '', affiliation: '', contact_email: '', contact_phone: '', notes: '' }));
      refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!admin) {
    return (
      <>
        <TopBar lang={LANG} email={email} onSignOut={signOut} />
        <SectionNav />
        <main style={{ padding: 18 }}>
          <div className="hd-card" style={{ padding: 18 }}>
            <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>접근 권한 없음</h2>
            <p className="hd-meta">딜러 등록은 Admin / Super Admin 만 가능합니다.</p>
          </div>
        </main>
      </>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

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

        {/* 등록 폼 */}
        <div className="hd-card" style={{ padding: 18 }}>
          <h2 className="hd-h2" style={{ margin: 0, marginBottom: 6 }}>딜러 등록 — 통합 발급</h2>
          <p className="hd-meta" style={{ marginBottom: 14 }}>
            한 폼으로 ① Voice JWT(QR) + ② Sensor Extension 키 + ③ ZIP 묶음 일괄 발급.
            ZIP 안에 install.bat (한국인) / install-ru.bat (러시아인) + 인쇄용 dealer-info.html 포함.
          </p>
          <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Dealer ID *" hint="소문자·숫자·_·-">
              <input required value={form.dealer_id} onChange={set('dealer_id')} pattern="^[a-z0-9][a-z0-9_-]{1,63}$"
                placeholder="dealer_001" style={inputStyle} />
            </Field>
            <Field label="이름 *">
              <input required value={form.name} onChange={set('name')} placeholder="Ivan Ivanov / 김딜러" style={inputStyle} />
            </Field>
            <Field label="소속회사" hint="자유 텍스트 (향후 분할)">
              <input value={form.affiliation} onChange={set('affiliation')} placeholder="HD-Russia Trading" style={inputStyle} />
            </Field>
            <Field label="Region">
              <select value={form.region} onChange={set('region')} style={inputStyle}>
                <option value="ru">RU · Россия</option>
                <option value="kr">KR · 한국</option>
                <option value="global">Global</option>
              </select>
            </Field>
            <Field label="Event">
              <input value={form.event} onChange={set('event')} pattern="^[a-z0-9][a-z0-9_-]{1,63}$"
                placeholder="ctt_moscow_2026" style={inputStyle} />
            </Field>
            <Field label="이메일">
              <input type="email" value={form.contact_email} onChange={set('contact_email')} placeholder="ivan@example.ru" style={inputStyle} />
            </Field>
            <Field label="전화">
              <input value={form.contact_phone} onChange={set('contact_phone')} placeholder="+7 ..." style={inputStyle} />
            </Field>
            <Field label="메모" style={{ gridColumn: '1 / -1' }}>
              <textarea value={form.notes} onChange={set('notes') as any} rows={2} style={{ ...inputStyle, height: 60 }} />
            </Field>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" className="hd-btn primary" disabled={busy}>
                {busy ? '발급 중 (JWT + Sensor + ZIP)…' : '등록 + 일괄 발급 + ZIP 다운로드'}
              </button>
            </div>
          </form>
        </div>

        {/* 발급 결과 */}
        {result && (
          <div className="hd-card" style={{ padding: 18, borderColor: 'var(--hd-prosperity)', background: 'var(--hd-accent-50)' }}>
            <h2 className="hd-h2" style={{ margin: 0, marginBottom: 14, color: 'var(--hd-prosperity)' }}>
              ✓ 발급 완료 · {result.dealer_id}
            </h2>
            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {result.qr_data_url && (
                <div>
                  <img src={result.qr_data_url} alt="Voice QR" style={{ width: 220, height: 220, border: '1px solid var(--hd-steel-200)', background: '#fff' }} />
                  <div className="hd-meta" style={{ textAlign: 'center', marginTop: 6 }}>Voice 설문 QR</div>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 320 }}>
                <Meta label="ZIP 다운로드" value={result.zip_filename + ' — 자동 시작'} mono />
                <Meta label="Voice URL" value={result.voice_url} mono small />
                <Meta label="Voice JTI" value={result.voice_jti} mono small />
                <Meta label="Sensor Key ID" value={result.sensor_key_id} mono />
                <p className="hd-meta" style={{ marginTop: 12, lineHeight: 1.6 }}>
                  → ZIP을 딜러에게 전달 (이메일·메신저). 압축 풀고 <code>install.bat</code> 또는 <code>install-ru.bat</code> 더블클릭.<br/>
                  → QR은 인쇄용 dealer-info.html 에도 포함 (ZIP 안).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 목록 */}
        <div className="hd-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="hd-h2" style={{ margin: 0 }}>등록된 딜러</h2>
            <span style={{ flex: 1 }} />
            {loading && <span className="hd-meta">로딩…</span>}
            <button className="hd-btn sm" onClick={refresh}>새로고침</button>
          </div>
          <table className="hd-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Dealer ID</th><th>이름</th><th>소속회사</th>
                <th>Region</th><th>Event</th><th>연락처</th><th>등록 시각</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dealer_id}>
                  <td className="hd-num">{r.dealer_id}</td>
                  <td>{r.name}</td>
                  <td>{r.affiliation ?? <span className="hd-meta">–</span>}</td>
                  <td className="hd-meta">{r.region ?? '–'}</td>
                  <td className="hd-meta">{r.event ?? '–'}</td>
                  <td className="hd-meta">{r.contact_email || r.contact_phone || '–'}</td>
                  <td className="hd-num">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="hd-meta" style={{ textAlign: 'center', padding: 18 }}>등록된 딜러 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function Field({ label, hint, style, children }: { label: string; hint?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <label className="hd-eyebrow" style={{ marginBottom: 4 }}>
        {label}{hint && <span className="hd-meta" style={{ marginLeft: 6 }}>({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function Meta({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div style={{ marginBottom: 6, display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'baseline' }}>
      <span className="hd-eyebrow">{label}</span>
      <span style={{
        fontFamily: mono ? 'var(--hd-mono)' : 'inherit',
        fontSize: small ? 11 : 13, color: 'var(--hd-ink)', wordBreak: 'break-all',
      }}>{value || '–'}</span>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', color: 'var(--hd-ink)',
};
