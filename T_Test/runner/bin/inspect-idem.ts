// QA inspect — idempotency_records 최근 finalize 응답 본문 확인.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // idempotency_records 또는 processed_events — 어디에 있나
  for (const tbl of ['idempotency_records', 'processed_events']) {
    const { data, error } = await sb
      .from(tbl)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    console.log(`=== ${tbl} ===`);
    if (error) { console.log(`  ERROR: ${error.message}`); continue; }
    if (!data || data.length === 0) { console.log('  (empty)'); continue; }
    console.log('  columns:', Object.keys(data[0]).join(', '));
    for (const r of data) {
      console.log('  ' + JSON.stringify(r));
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
