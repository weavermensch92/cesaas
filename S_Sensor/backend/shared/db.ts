// Supabase service-role client factory.
import { createClient, type SupabaseClient } from 'supabase-js';
import { envRequired } from './env.ts';

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    envRequired('SUPABASE_URL'),
    envRequired('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
  return cached;
}
