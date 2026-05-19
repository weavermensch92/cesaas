'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { getMe, markPasswordSet, type MeProfile } from '@/lib/api';

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 12px', marginTop: 6, marginBottom: 14,
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', color: 'var(--hd-ink)',
};

export default function SetPasswordPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supa = getSupabase();
      const { data } = await supa.auth.getSession();
      if (!data.session) { router.replace('/'); return; }
      try {
        const m = await getMe();
        setMe(m);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setReady(true);
      }
    })();
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw1.length < 8) { setErr('비밀번호는 8자 이상'); return; }
    if (pw1 !== pw2)    { setErr('비밀번호 확인이 일치하지 않습니다'); return; }
    setStatus('submitting');
    try {
      const { error } = await getSupabase().auth.updateUser({ password: pw1 });
      if (error) throw error;
      await markPasswordSet();
      setStatus('done');
      setTimeout(() => router.replace('/'), 800);
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (!ready) return <div style={{ padding: 32 }}>로딩중…</div>;

  return (
    <div style={{ maxWidth: 420, margin: '120px auto', padding: 24 }}>
      <div className="hd-card" style={{ padding: 24 }}>
        <h1 className="hd-h1" style={{ marginTop: 0, marginBottom: 4 }}>비밀번호 설정</h1>
        <h2 className="hd-h2" style={{ marginTop: 0, marginBottom: 16 }}>
          {me?.password_set ? '비밀번호 재설정' : '신규 비밀번호 설정'}
        </h2>
        <p className="hd-meta" style={{ marginBottom: 14 }}>
          {me?.email} 으로 매직 링크 인증 완료. 이후 사용할 비밀번호를 입력하세요.
        </p>

        <form onSubmit={submit}>
          <label className="hd-eyebrow">새 비밀번호 (8자 이상)</label>
          <input
            type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
            required minLength={8} placeholder="••••••••" style={inputStyle}
            autoComplete="new-password"
          />
          <label className="hd-eyebrow">새 비밀번호 확인</label>
          <input
            type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
            required minLength={8} placeholder="••••••••" style={inputStyle}
            autoComplete="new-password"
          />
          <button
            type="submit" className="hd-btn primary"
            style={{ width: '100%', height: 36 }}
            disabled={status === 'submitting' || status === 'done'}
          >
            {status === 'submitting' ? '저장 중…'
             : status === 'done' ? '✓ 완료. 이동 중…'
             : '저장'}
          </button>
          {err && <p className="hd-meta" style={{ marginTop: 12, color: 'var(--hd-red)' }}>{err}</p>}
        </form>
      </div>
    </div>
  );
}
