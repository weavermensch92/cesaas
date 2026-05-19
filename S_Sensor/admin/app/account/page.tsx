'use client';
import { useState, type FormEvent } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import type { MeProfile } from '@/lib/api';

const LANG: Lang = 'ko';

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 12px', marginTop: 6, marginBottom: 14,
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', color: 'var(--hd-ink)',
};

const roleLabel: Record<MeProfile['role'], string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  regular: '일반',
};

export default function AccountPage() {
  return <AuthGate>{({ session, me }) => <View email={session.user.email ?? ''} me={me} />}</AuthGate>;
}

function View({ email, me }: { email: string; me: MeProfile }) {
  const signOut = () => { getSupabase().auth.signOut(); };
  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />
      <main style={{ padding: 18, display: 'grid', gap: 18, maxWidth: 720 }}>
        <ProfileCard me={me} />
        <ChangePasswordCard email={email} />
      </main>
    </>
  );
}

function ProfileCard({ me }: { me: MeProfile }) {
  return (
    <div className="hd-card" style={{ padding: 18 }}>
      <h2 className="hd-h2" style={{ margin: 0, marginBottom: 12 }}>내 계정</h2>
      <table style={{ width: '100%' }}>
        <tbody>
          <Row label="이메일" value={me.email} />
          <Row label="등급" value={roleLabel[me.role]} />
          <Row label="비밀번호" value={me.password_set ? '설정됨' : '미설정'} />
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="hd-eyebrow" style={{ padding: '6px 0', width: 120 }}>{label}</td>
      <td className="hd-num" style={{ padding: '6px 0' }}>{value}</td>
    </tr>
  );
}

function ChangePasswordCard({ email }: { email: string }) {
  const [cur, setCur] = useState('');
  const [nw1, setNw1] = useState('');
  const [nw2, setNw2] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (nw1.length < 8) { setErr('새 비밀번호는 8자 이상'); return; }
    if (nw1 !== nw2)    { setErr('비밀번호 확인 불일치'); return; }
    setStatus('submitting');
    try {
      // 1. 기존 비번 검증 (signInWithPassword 으로 — 성공 시 세션 갱신)
      const supa = getSupabase();
      const { error: vErr } = await supa.auth.signInWithPassword({ email, password: cur });
      if (vErr) { setStatus('error'); setErr('기존 비밀번호가 일치하지 않습니다'); return; }
      // 2. 새 비번 설정
      const { error: uErr } = await supa.auth.updateUser({ password: nw1 });
      if (uErr) throw uErr;
      setStatus('done');
      setMsg('비밀번호가 변경되었습니다');
      setCur(''); setNw1(''); setNw2('');
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="hd-card" style={{ padding: 18 }}>
      <h2 className="hd-h2" style={{ margin: 0, marginBottom: 12 }}>비밀번호 변경</h2>
      <p className="hd-meta" style={{ marginBottom: 14 }}>
        기존 비밀번호를 입력하여 본인 확인 후 새 비밀번호를 설정합니다.
      </p>
      <form onSubmit={submit}>
        <label className="hd-eyebrow">기존 비밀번호</label>
        <input
          type="password" value={cur} onChange={(e) => setCur(e.target.value)}
          required style={inputStyle} autoComplete="current-password"
        />
        <label className="hd-eyebrow">새 비밀번호 (8자 이상)</label>
        <input
          type="password" value={nw1} onChange={(e) => setNw1(e.target.value)}
          required minLength={8} style={inputStyle} autoComplete="new-password"
        />
        <label className="hd-eyebrow">새 비밀번호 확인</label>
        <input
          type="password" value={nw2} onChange={(e) => setNw2(e.target.value)}
          required minLength={8} style={inputStyle} autoComplete="new-password"
        />
        <button
          type="submit" className="hd-btn primary"
          style={{ height: 36 }}
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? '변경 중…' : '비밀번호 변경'}
        </button>
        {msg && <p className="hd-meta" style={{ marginTop: 12, color: 'var(--hd-green)' }}>{msg}</p>}
        {err && <p className="hd-meta" style={{ marginTop: 12, color: 'var(--hd-red)' }}>{err}</p>}
      </form>
    </div>
  );
}
