'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { getMe, type MeProfile } from '@/lib/api';
import { Login } from './Login';

export interface AuthCtx {
  session: Session;
  me: MeProfile;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used within AuthGate');
  return v;
}

export function useMaybeAuth(): AuthCtx | null {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: (ctx: AuthCtx) => ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [meErr, setMeErr] = useState<string | null>(null);

  useEffect(() => {
    const supa = getSupabase();
    supa.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supa.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    let cancelled = false;
    setMeErr(null);
    getMe()
      .then((p) => { if (!cancelled) setMe(p); })
      .catch((e) => { if (!cancelled) setMeErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!me || !pathname) return;
    if (!me.password_set && pathname !== '/set-password') {
      router.replace('/set-password');
    }
  }, [me, pathname, router]);

  if (session === undefined) return <div style={{ padding: 32 }}>로딩중…</div>;
  if (session === null)      return <Login />;
  if (meErr)                 return <div style={{ padding: 32, color: 'var(--hd-red)' }}>프로필 로딩 실패: {meErr}</div>;
  if (!me)                   return <div style={{ padding: 32 }}>로딩중…</div>;

  if (!me.password_set && pathname !== '/set-password') {
    return <div style={{ padding: 32 }}>비밀번호 설정 페이지로 이동 중…</div>;
  }

  const ctx: AuthCtx = { session, me };
  return <AuthContext.Provider value={ctx}>{children(ctx)}</AuthContext.Provider>;
}

export function isAdminRole(role: MeProfile['role']): boolean {
  return role === 'super_admin' || role === 'admin';
}
