// QA probe — chunks INSERT 후 bytes column 정체 확인.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { makeSensorFixture } from '../lib/fixtures.js';
import { sendAllChunks } from '../lib/sensor-helpers.js';

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const keyId = `probe_${randomUUID().slice(0, 8)}`;
  const secret = randomBytes(32).toString('hex');
  await sb.from('sensor_api_keys').insert({
    key_id: keyId, secret, dealer_id: null, description: 'PROBE',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const fx = makeSensorFixture({ dealerId: 'probe' });
  const clientBytes = fx.bytes;
  const clientHash = createHash('sha256').update(clientBytes).digest('hex');
  console.log('client bytes', { len: clientBytes.length, hex: Buffer.from(clientBytes).toString('hex'), hash: clientHash });

  const chunks = await sendAllChunks({ keyId, secret }, fx);
  console.log('chunks send result', chunks);

  // DB에서 직접 SELECT
  const { data, error } = await sb
    .from('capture_chunks')
    .select('chunk_index, bytes, chunk_hash')
    .eq('capture_id', fx.captureId)
    .order('chunk_index', { ascending: true });
  if (error) { console.error('select err', error.message); process.exit(1); }
  if (!data || data.length === 0) { console.error('no chunks'); process.exit(1); }

  for (const row of data) {
    const raw = row.bytes;
    console.log(`\nchunk ${row.chunk_index}:`);
    console.log(`  typeof raw    : ${typeof raw}`);
    console.log(`  raw.constructor : ${raw?.constructor?.name}`);
    if (typeof raw === 'string') {
      console.log(`  raw.length    : ${raw.length}`);
      console.log(`  raw[0..40]    : ${JSON.stringify(raw.slice(0, 40))}`);
      console.log(`  starts \\\\x?   : ${raw.startsWith('\\x')}`);
    } else if (raw instanceof Uint8Array) {
      console.log(`  byte length   : ${raw.byteLength}`);
      console.log(`  hex           : ${Buffer.from(raw).toString('hex')}`);
    } else {
      console.log(`  raw           : ${JSON.stringify(raw).slice(0, 100)}`);
    }
    console.log(`  stored chunk_hash : ${row.chunk_hash}`);
    console.log(`  expected hash     : ${clientHash}`);
  }

  // cleanup
  await sb.from('capture_chunks').delete().eq('capture_id', fx.captureId);
  await sb.from('captures').delete().eq('id', fx.captureId);
  await sb.from('sensor_api_keys').update({ revoked_at: new Date().toISOString() }).eq('key_id', keyId);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
