// QA inspect — 최근 captures + entity_clusters 상태 점검.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: caps, error: cErr } = await sb
    .from('captures')
    .select('id, dealer_id, crm_id, entity_id, screen_type, status, classification_confidence, url_path, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  if (cErr) { console.error('captures err', cErr.message); process.exit(1); }
  console.log('=== latest captures (10) ===');
  for (const c of caps ?? []) {
    console.log(`  ${c.created_at} | ${c.dealer_id} | crm=${c.crm_id} | entity=${c.entity_id} | screen=${c.screen_type} | status=${c.status} | path=${c.url_path}`);
  }

  const { data: clusters, error: clErr } = await sb
    .from('entity_clusters')
    .select('id, entity_id, crm_id, capture_ids, image_count, status, normalized_at, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  if (clErr) { console.error('clusters err', clErr.message); process.exit(1); }
  console.log('\n=== latest entity_clusters (10) ===');
  for (const c of clusters ?? []) {
    console.log(`  ${c.created_at} | entity=${c.entity_id} | crm=${c.crm_id} | image_count=${c.image_count} | status=${c.status} | captures=${JSON.stringify(c.capture_ids)}`);
  }

  const { data: queue, error: qErr } = await sb
    .from('normalize_queue')
    .select('id, cluster_id, status, attempts, last_error, enqueued_at, started_at, completed_at')
    .order('enqueued_at', { ascending: false })
    .limit(10);
  if (qErr) { console.error('queue err', qErr.message); process.exit(1); }
  console.log('\n=== latest normalize_queue (10) ===');
  for (const q of queue ?? []) {
    console.log(`  ${q.enqueued_at} | cluster=${q.cluster_id} | status=${q.status} | attempts=${q.attempts} | err=${q.last_error ?? '-'}`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
