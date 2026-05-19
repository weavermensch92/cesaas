'use client';
import { useState, type FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';

type Mode = 'password' | 'magic';

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 12px', marginTop: 6, marginBottom: 14,
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', color: 'var(--hd-ink)',
};

export function Login() {
  const [mode, setMode] = useState<Mode>('password');

  return (
    <div style={{ maxWidth: 380, margin: '120px auto', padding: 24 }}>
      <div className="hd-card" style={{ padding: 24 }}>
        <h1 className="hd-h1" style={{ marginTop: 0, marginBottom: 4 }}>HD건설기계</h1>
        <h2 className="hd-h2" style={{ marginTop: 0, marginBottom: 16 }}>
          Sensor Admin · {mode === 'password' ? '로그인' : '매직 링크 발송'}
        </h2>

        {mode === 'password' ? <PasswordForm /> : <MagicForm />}

        <div style={{ marginTop: 18, textAlign: 'center' }}>
          {mode === 'password' ? (
            <a
              href="#"
              className="hd-meta"
              style={{ color: 'var(--hd-blue)' }}
              onClick={(e) => { e.preventDefault(); setMode('magic'); }}
            >
              처음 방문하시나요? / 비밀번호를 잊으셨나요?
            </a>
          ) : (
            <a
              href="#"
              className="hd-meta"
              style={{ color: 'var(--hd-blue)' }}
              onClick={(e) => { e.preventDefault(); setMode('password'); }}
            >
              ← 비밀번호 로그인으로
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function PasswordForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErr(null);
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      // AuthGate가 onAuthStateChange로 자동 진입
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="hd-eyebrow">이메일</label>
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        required placeholder="you@hd.com" style={inputStyle}
        autoComplete="username"
      />
      <label className="hd-eyebrow">비밀번호</label>
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        required placeholder="••••••••" style={inputStyle}
        autoComplete="current-password"
      />
      <button
        type="submit" className="hd-btn primary"
        style={{ width: '100%', height: 36 }}
        disabled={status === 'submitting'}
      >
        {status === 'submitting' ? '로그인 중…' : '로그인'}
      </button>
      {err && <p className="hd-meta" style={{ marginTop: 12, color: 'var(--hd-red)' }}>{err}</p>}
    </form>
  );
}

function MagicForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErr(null);
    try {
      const redirectTo = process.env['NEXT_PUBLIC_SITE_URL']
        ? `${process.env['NEXT_PUBLIC_SITE_URL']}/set-password`
        : `${window.location.origin}/set-password`;
      const { error } = await getSupabase().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (error) throw error;
      setStatus('sent');
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="hd-meta" style={{ marginBottom: 14 }}>
        관리자가 사전에 등록한 이메일로만 발송됩니다. 등록 안 된 이메일은 메일이 가지 않습니다.
      </p>
      <label className="hd-eyebrow">이메일</label>
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        required placeholder="you@hd.com" style={inputStyle}
        autoComplete="email"
      />
      <button
        type="submit" className="hd-btn primary"
        style={{ width: '100%', height: 36 }}
        disabled={status === 'sending' || status === 'sent'}
      >
        {status === 'sending' ? '발송 중…' : status === 'sent' ? '✓ 메일 발송' : '매직 링크 발송'}
      </button>
      {status === 'sent' && (
        <p className="hd-meta" style={{ marginTop: 12 }}>
          메일함을 확인하세요. 링크 클릭 시 자동 로그인 후 비밀번호 설정 페이지로 이동합니다.
        </p>
      )}
      {err && <p className="hd-meta" style={{ marginTop: 12, color: 'var(--hd-red)' }}>{err}</p>}
    </form>
  );
}
