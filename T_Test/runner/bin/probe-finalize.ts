// QA probe — single capture → chunks → finalize, finalize 응답 본문 출력.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { makeSensorFixture } from '../lib/fixtures.js';
import { sendAllChunks, sendFinalize } from '../lib/sensor-helpers.js';
import { db } from '../lib/db.js';

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // provision key
  const keyId = `probe_${randomUUID().slice(0, 8)}`;
  const secret = randomBytes(32).toString('hex');
  const { error: pkErr } = await sb.from('sensor_api_keys').insert({
    key_id: keyId, secret, dealer_id: null, description: 'PROBE',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (pkErr) { console.error('key insert err', pkErr.message); process.exit(1); }
  console.log('key provisioned', keyId);

  const fx = makeSensorFixture({ dealerId: 'probe_dealer' });
  console.log('fixture', { captureId: fx.captureId, entityId: fx.entityId, urlPath: fx.urlPath });

  const chunks = await sendAllChunks({ keyId, secret }, fx);
  console.log('chunks', chunks);

  const fin = await sendFinalize({ keyId, secret }, fx, chunks.totalChunks, chunks.fullHashHex);
  console.log('=== finalize response ===');
  console.log('  status:', fin.status);
  console.log('  duration_ms:', fin.durationMs);
  console.log('  body:', JSON.stringify(fin.body, null, 2));

  // 즉시 capture 상태 조회
  const { data: cap } = await db().from('captures')
    .select('id, status, screen_type, entity_id, classification_method, classification_confidence, image_path, finalized_at, classified_at')
    .eq('id', fx.captureId)
    .maybeSingle();
  console.log('=== capture row after finalize ===');
  console.log('  ', JSON.stringify(cap, null, 2));

  // cleanup
  await sb.from('captures').delete().eq('id', fx.captureId);
  await sb.from('capture_chunks').delete().eq('capture_id', fx.captureId);
  await sb.from('sensor_api_keys').update({ revoked_at: new Date().toISOString() }).eq('key_id', keyId);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
