'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY 환경변수 누락');
  }
  cached = createBrowserClient(url, key);
  return cached;
}
