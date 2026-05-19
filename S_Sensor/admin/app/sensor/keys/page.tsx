'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate, isAdminRole } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import type { MeProfile } from '@/lib/api';

const LANG: Lang = 'ko';

interface SensorKey {
  key_id: string;
  dealer_id: string | null;
  description: string | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string;
}

export default function SensorKeysPage() {
  return <AuthGate>{({ session, me }) => <View email={session.user.email ?? ''} me={me} />}</AuthGate>;
}

function View({ email, me }: { email: string; me: MeProfile }) {
  const signOut = () => { getSupabase().auth.signOut(); };
  const admin = isAdminRole(me.role);

  const [rows, setRows] = useState<SensorKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [dealerId, setDealerId] = useState('');
  const [label, setLabel] = useState('');

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
      const r = await fetch('/api/sensor-keys/issue', init);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const d = await r.json();
      setRows(d.data || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [admin, authedFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  async function issue(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErr(null);
    try {
      const init = await authedFetch();
      const r = await fetch('/api/sensor-keys/issue', {
        ...init,
        method: 'POST',
        headers: { ...init.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealer_id: dealerId.trim() || null, label: label.trim() || null }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);

      // 파일명 추출
      const cd = r.headers.get('content-disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const fname = m?.[1] || `hd-sensor-${Date.now()}.zip`;
      const keyId = r.headers.get('x-hd-key-id') || '';

      // 자동 다운로드
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      setMsg(`발급 완료 · ${keyId} · ${fname} 다운로드 시작`);
      setDealerId(''); setLabel('');
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!admin) {
    return (
      <>
        <TopBar lang={LANG} email={email} onSignOut={signOut} />
        <SectionNav />
        <main style={{ padding: 18 }}>
          <div className="hd-card" style={{ padding: 18 }}>
            <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>접근 권한 없음</h2>
            <p className="hd-meta">Sensor 키 발급은 Admin / Super Admin 만 가능합니다.</p>
          </div>
        </main>
      </>
    );
  }

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

        <div className="hd-card" style={{ padding: 18 }}>
          <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>Sensor Extension 발급</h2>
          <p className="hd-meta" style={{ marginBottom: 14 }}>
            클릭 한 번으로 HMAC 키 + Chrome Extension + 설치 스크립트(.bat) 를 ZIP 으로 다운로드.
            러시아인·한국인 사용자 모두 호환 (install.bat / install-ru.bat).
          </p>
          <form onSubmit={issue} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 220px' }}>
              <label className="hd-eyebrow" style={{ marginBottom: 4 }}>Dealer ID (옵션, 비우면 글로벌)</label>
              <input
                type="text" placeholder="dealer_001"
                value={dealerId} onChange={(e) => setDealerId(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 220px' }}>
              <label className="hd-eyebrow" style={{ marginBottom: 4 }}>Label (옵션, 메모)</label>
              <input
                type="text" placeholder="CTT Moscow PC #1"
                value={label} onChange={(e) => setLabel(e.target.value)}
                style={inputStyle}
              />
            </div>
            <button type="submit" className="hd-btn primary" disabled={busy}>
              {busy ? '발급 + 패키징 중…' : '발급 + ZIP 다운로드'}
            </button>
          </form>
          {msg && <div className="hd-meta" style={{ marginTop: 10, color: 'var(--hd-green)' }}>{msg}</div>}
        </div>

        <div className="hd-card" style={{ padding: 18 }}>
          <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>설치 안내</h2>
          <ol className="hd-meta" style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <li>발급된 ZIP을 사용자에게 전달 (이메일·메신저)</li>
            <li>사용자가 압축 풀고 <b style={{ color: 'var(--hd-ink)' }}>install.bat</b> 또는 <b style={{ color: 'var(--hd-ink)' }}>install-ru.bat</b> 더블클릭</li>
            <li>Chrome 자동 탐지 + 바탕화면에 "HD Sensor Chrome" 바로가기 생성</li>
            <li>바로가기 클릭 시 전용 Chrome 인스턴스 실행 — Extension 자동 로드</li>
            <li>Bitrix24 접속 → CRM 화면 캡쳐 자동 시작</li>
          </ol>
        </div>

        <div className="hd-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="hd-h2" style={{ margin: 0 }}>발급된 키</h2>
            <span style={{ flex: 1 }} />
            {loading && <span className="hd-meta">로딩…</span>}
            <button className="hd-btn sm" onClick={refresh} style={{ marginLeft: 8 }}>새로고침</button>
          </div>
          <table className="hd-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Key ID</th>
                <th>Dealer ID</th>
                <th>Label</th>
                <th>발급 시각</th>
                <th>만료</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key_id}>
                  <td className="hd-num">{r.key_id}</td>
                  <td>{r.dealer_id ?? <span className="hd-meta">(global)</span>}</td>
                  <td className="hd-meta">{r.description ?? '–'}</td>
                  <td className="hd-num">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                  <td className="hd-num">{new Date(r.expires_at).toLocaleDateString('ko-KR')}</td>
                  <td>
                    {r.revoked_at
                      ? <span className="hd-badge ghost">폐기됨</span>
                      : new Date(r.expires_at) < new Date()
                        ? <span className="hd-badge red">만료</span>
                        : <span className="hd-badge green">활성</span>}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="hd-meta" style={{ textAlign: 'center', padding: 18 }}>발급된 키 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', color: 'var(--hd-ink)',
};
