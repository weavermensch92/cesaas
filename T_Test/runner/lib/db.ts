import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from './config.js';

let cached: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(CONFIG.supabaseUrl, CONFIG.serviceKey, {
    auth: { persistSession: false },
  });
  return cached;
}
