// Server-only Supabase client (service_role).
// Next.js API routes / Server Actions. 클라이언트 번들에 절대 포함되면 안 됨.

import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (cached) return cached;
  const url =
    process.env['SUPABASE_URL'] ||
    process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url) throw new Error('SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL 미설정');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 (Fly secret 등록 필요)');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
