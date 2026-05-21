// 가장 최근 archived R_10.06 row를 active로 복원.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;

const SQL = `
UPDATE rule_versions
SET status = 'active', archived_at = NULL
WHERE id = '5c50c416-acc7-435c-864b-98af52651c94';

SELECT id, version, status FROM rule_versions
WHERE rule_id = 'R_10.06_PromptTemplates' AND status = 'active';
`;

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL }),
});
console.log('HTTP', r.status);
console.log(await r.text());

export {};
