// QA — 마이그레이션 029 (save_response 옛 시그니처 DROP)를 Management API로 실행.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;

if (!TOKEN || !REF) {
  console.error('SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF missing');
  process.exit(1);
}

const SQL = `
DROP FUNCTION IF EXISTS public.save_response(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, BOOLEAN,
  TEXT, TEXT, REAL, JSONB, JSONB, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, BOOLEAN
);

SELECT
  oid,
  pg_get_function_identity_arguments(oid) AS signature,
  pronargs
FROM pg_proc
WHERE proname = 'save_response'
  AND pronamespace = 'public'::regnamespace;
`;

async function main() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  });
  const text = await r.text();
  console.log('HTTP', r.status);
  console.log(text);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });

export {};
