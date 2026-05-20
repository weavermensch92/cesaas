// QA probe — /sensor/crm 흐름 (DB 직접). API 라우트는 Next.js admin이 돌고 있어야 하지만
// production 검증 목적이라 DB 직접 INSERT/SELECT/DELETE로 동등 검증.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    console.log(`  ✓ ${name}`, r !== undefined ? `→ ${JSON.stringify(r).slice(0, 100)}` : '');
    return r;
  } catch (e) {
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
    throw e;
  }
}

async function main() {
  console.log('=== /sensor/crm flow (DB equivalent) ===');

  // 1) 가상 amocrm 등록 (upsert)
  await step('upsert amocrm (wizard 결과 시뮬레이션)', async () => {
    const { data, error } = await sb.from('crm_definitions').upsert({
      id: 'amocrm_qa',
      name: 'amoCRM QA',
      description: 'QA — synthetic',
      host_pattern: '^https://[^/]+\\.amocrm\\.ru/',
      match_patterns: ['https://*.amocrm.ru/leads/*', 'https://*.amocrm.ru/contacts/*'],
      capture_paths: ['/leads/', '/contacts/'],
      screen_patterns: [
        { screen: 'lead_detail', url_regex: '^/leads/detail/(\\d+)/?$', entity_extract_group: 1 },
        { screen: 'lead_list',   url_regex: '^/leads/?$' },
        { screen: 'contact_detail', url_regex: '^/contacts/detail/(\\d+)/?$', entity_extract_group: 1 },
      ],
      version: 1,
      status: 'active',
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: data.id, version: data.version, status: data.status };
  });

  // 2) 목록 (active + beta)
  const list = await step('SELECT active+beta', async () => {
    const { data, error } = await sb
      .from('crm_definitions')
      .select('id, name, status, match_patterns, capture_paths')
      .in('status', ['active', 'beta'])
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data;
  }) as Array<{ id: string; match_patterns: string[]; capture_paths: string[] }>;
  console.log('     rows:', list.length);
  for (const r of list) {
    console.log(`     - ${r.id} | matches=${r.match_patterns.join(',')} | paths=${r.capture_paths.join(',')}`);
  }

  // 3) 발급 ZIP의 manifest 생성 (issue/route.ts의 buildManifest 로직 미러)
  await step('build manifest.json (issue route equivalent)', async () => {
    const matches = new Set<string>();
    for (const c of list) for (const m of c.match_patterns) matches.add(m);
    const arr = [...matches];
    if (arr.length === 0) throw new Error('no match_patterns');
    const manifest = {
      manifest_version: 3,
      name: 'HD건설기계 Sensor',
      version: '0.2.0',
      host_permissions: arr,
      content_scripts: [{ matches: arr, js: ['content.js'], run_at: 'document_idle' }],
    };
    return { total_matches: arr.length, sample: arr.slice(0, 3) };
  });

  // 4) crm_definitions.json 생성 (per-CRM)
  await step('build crm_definitions.json', async () => {
    const { data, error } = await sb
      .from('crm_definitions')
      .select('id, name, host_pattern, capture_paths, screen_patterns')
      .in('status', ['active', 'beta']);
    if (error) throw new Error(error.message);
    const out: Record<string, unknown> = {};
    for (const c of data ?? []) {
      out[c.id] = {
        id: c.id, name: c.name, host_pattern: c.host_pattern,
        capture_paths: c.capture_paths?.length ? c.capture_paths : ['/'],
        screen_patterns: c.screen_patterns ?? [],
      };
    }
    return { crms: Object.keys(out), bitrix24_screens: (out.bitrix24 as any)?.screen_patterns?.length };
  });

  // 5) status=deprecated 시 발급 ZIP에서 제외되는지 (state transition)
  await step('amocrm_qa → deprecated', async () => {
    const { error } = await sb.from('crm_definitions').update({ status: 'deprecated' }).eq('id', 'amocrm_qa');
    if (error) throw new Error(error.message);
  });
  const list2 = await step('SELECT active+beta after deprecate', async () => {
    const { data, error } = await sb.from('crm_definitions').select('id').in('status', ['active', 'beta']);
    if (error) throw new Error(error.message);
    return data?.map((d: any) => d.id);
  });

  // 6) DELETE — FK 보호 검증 위해 captures 있을 때 (없으면 그냥 delete 성공)
  await step('DELETE amocrm_qa (captures.crm_id FK)', async () => {
    const { count } = await sb.from('captures').select('id', { count: 'exact', head: true }).eq('crm_id', 'amocrm_qa');
    if ((count ?? 0) > 0) {
      throw new Error(`captures referencing — 409 expected (count=${count})`);
    }
    const { error } = await sb.from('crm_definitions').delete().eq('id', 'amocrm_qa');
    if (error) throw new Error(error.message);
    return 'deleted (no captures)';
  });

  // 7) bitrix24 row 보호 — 정상 active 상태 유지 확인
  await step('bitrix24 still active', async () => {
    const { data, error } = await sb.from('crm_definitions').select('id, status, match_patterns').eq('id', 'bitrix24').single();
    if (error) throw new Error(error.message);
    if (data.status !== 'active') throw new Error(`status=${data.status}`);
    if (!data.match_patterns?.length) throw new Error('match_patterns empty');
    return { status: data.status, matches: data.match_patterns.length };
  });
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
