// Gridge Sensor — build-time config injection point.
// 실제 빌드 시 config.js로 복사 + 시크릿 주입. config.js는 .gitignore.
//
// S_10.01 § 5 환경변수.

export const CONFIG = {
  API_BASE: 'https://__SUPABASE_REF__.supabase.co/functions/v1',
  API_KEY_ID: 'ext_001',
  HMAC_SECRET: '__INJECT_AT_BUILD__',     // 32 bytes hex
  DEALER_ID: 'dealer_001',
  DEBUG: false,
};
