async function main() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='enqueue_normalize_priority' AND pronamespace='public'::regnamespace;` }),
  });
  const data: any = await r.json();
  console.log(data[0]?.def?.slice(0, 3000));
}
main();

export {};
