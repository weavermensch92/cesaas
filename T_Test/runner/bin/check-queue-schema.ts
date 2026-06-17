async function main() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'normalize_queue' ORDER BY ordinal_position;
    ` }),
  });
  console.log(await r.text());
}
main();

export {};
