const r = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `
    SELECT proname, pg_get_function_identity_arguments(oid) AS args
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND (proname LIKE '%score%' OR proname LIKE '%dealer_output%' OR proname LIKE '%lead%')
    ORDER BY proname;
  ` }),
});
console.log(await r.text());

export {};
