'use client';
import { useState, type FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErr(null);
    try {
      const redirectTo = process.env['NEXT_PUBLIC_SITE_URL'] ?? window.location.origin;
      const { error } = await getSupabase().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setStatus('sent');
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '120px auto', padding: 24 }}>
      <div className="hd-card" style={{ padding: 24 }}>
        <h1 className="hd-h1" style={{ marginTop: 0, marginBottom: 4 }}>HD건설기계</h1>
        <h2 className="hd-h2" style={{ marginTop: 0, marginBottom: 16 }}>Sensor Admin · 로그인</h2>

        <form onSubmit={submit}>
          <label className="hd-eyebrow">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@hd.com"
            style={{
              width: '100%', height: 36, padding: '0 12px', marginTop: 6, marginBottom: 14,
              border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
              font: 'inherit', color: 'var(--hd-ink)',
            }}
          />

          <button
            type="submit"
            className="hd-btn primary"
            style={{ width: '100%', height: 36 }}
            disabled={status === 'sending' || status === 'sent'}
          >
            {status === 'sending' ? '발송 중…'
              : status === 'sent' ? '✓ 메일 확인'
              : 'Magic link 발송'}
          </button>

          {status === 'sent' && (
            <p className="hd-meta" style={{ marginTop: 12 }}>
              메일함을 확인하세요. 링크 클릭 시 자동 로그인.
            </p>
          )}
          {err && (
            <p className="hd-meta" style={{ marginTop: 12, color: 'var(--hd-red)' }}>{err}</p>
          )}
        </form>
      </div>
    </div>
  );
}
