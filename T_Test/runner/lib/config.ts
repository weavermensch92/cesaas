// 환경변수 — .env.local 또는 process.env에서 읽음.
// 실제 Supabase 프로젝트 + VOICE_JWT_SECRET + (옵션) ANTHROPIC_API_KEY 필요.

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`env missing: ${key}`);
  return v;
}
function opt(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const CONFIG = {
  supabaseUrl:     need('SUPABASE_URL'),
  serviceKey:      need('SUPABASE_SERVICE_ROLE_KEY'),
  apiBase:         opt('T_TEST_API_BASE', '').replace(/\/$/, '') || `${need('SUPABASE_URL').replace(/\/$/, '')}/functions/v1`,
  jwtSecret:       opt('VOICE_JWT_SECRET'),
  jwtIssuer:       opt('VOICE_JWT_ISSUER', 'hd-poc'),
  event:           opt('T_TEST_EVENT', 'ctt_moscow_2026'),
  actor:           opt('T_TEST_ACTOR', 'weaver@gridge.co.kr'),
  env:             opt('T_TEST_ENV', 'dev'),
  /** LLM 정확도 검증 까지 돌릴지 (비용 발생) */
  includeLlm:      opt('T_TEST_LLM', 'false') === 'true',
  /** finalize 후 cluster status 가 'normalized' 가 될 때까지 기다리는 최대 시간 */
  normalizeTimeoutMs: Number(opt('T_TEST_NORMALIZE_TIMEOUT_MS', '120000')),
  /** dirty 데이터 정리할지 */
  cleanup:         opt('T_TEST_CLEANUP', 'true') !== 'false',
  /** T_07.01 Fly.io fallback base URL — 빈 문자열이면 hosting failover scenario skip. */
  fallbackBase:    opt('T_TEST_FALLBACK_BASE', '').replace(/\/$/, ''),
};
