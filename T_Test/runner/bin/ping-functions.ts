// QA inspect — Edge Functions deploy 상태 점검 (HEAD/GET).
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const FNS = [
  'auth-me',
  'captures-chunks',
  'captures-finalize',
  'normalize-worker',
  'admin-captures',
  'admin-clusters',
  'admin-leads',
  'admin-test-summary',
  'admin-settings',
  'admin-llm-usage',
  'admin-members',
  'admin-field-edit',
  'admin-normalize-trigger',
  'admin-lead-associate',
  'admin-leads-detail',
  'responses-receive',
  'voice-responses',
  'voice-aggregates',
  'voice-realtime',
  'voice-csv-export',
  'dealer-tokens-issue',
  'dealer-tokens-list',
  'dealer-tokens-revoke',
  'studio-build-survey',
  'studio-deploy',
];

async function main() {
  for (const fn of FNS) {
    try {
      const r = await fetch(`${url}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const text = await r.text();
      const short = text.length > 80 ? text.slice(0, 80) + '...' : text;
      console.log(`  ${fn.padEnd(28)} ${r.status} ${short}`);
    } catch (e) {
      console.log(`  ${fn.padEnd(28)} ERR ${(e as Error).message}`);
    }
  }
}
main();

export {};
