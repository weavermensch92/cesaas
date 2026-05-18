'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { Login } from './Login';

export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const supa = getSupabase();
    supa.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supa.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div style={{ padding: 32 }}>로딩중…</div>;
  }
  if (session === null) {
    return <Login />;
  }
  return <>{children(session)}</>;
}
