// QA inspect — rule_versions + crm_definitions 상태.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: rules, error: rErr } = await sb
    .from('rule_versions')
    .select('*')
    .order('rule_id', { ascending: true });
  if (rErr) { console.error('rules err', rErr.message); process.exit(1); }
  console.log('=== rule_versions (raw) ===');
  if (rules && rules.length > 0) {
    console.log('columns:', Object.keys(rules[0]).join(', '));
  }
  for (const r of rules ?? []) {
    console.log(' ', JSON.stringify(r));
  }

  const { data: crms, error: cErr } = await sb
    .from('crm_definitions')
    .select('id, name, host_pattern, screen_patterns, match_patterns, capture_paths, status');
  if (cErr) { console.error('crms err', cErr.message); process.exit(1); }
  console.log('\n=== crm_definitions ===');
  for (const c of crms ?? []) {
    const sp = Array.isArray(c.screen_patterns) ? c.screen_patterns.length : 'non-array';
    console.log(`  ${c.id} | ${c.name} | status=${c.status} | screen_patterns=${sp} | host=${c.host_pattern}`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
