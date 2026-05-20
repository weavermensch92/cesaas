import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data, error } = await sb.from('rule_versions').select('id, rule_id, version, status, created_at, archived_at').eq('rule_id', 'R_10.06_PromptTemplates').order('created_at', { ascending: false });
console.log(error?.message ?? JSON.stringify(data, null, 2));
