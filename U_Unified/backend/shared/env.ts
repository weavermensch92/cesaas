// Typed env accessor for Edge Functions (Deno).
// 시크릿은 Supabase secrets로 주입 (C_08_배포_환경변수.md).

export function envRequired(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`env missing: ${key}`);
  return v;
}

export function envOptional(key: string, fallback = ''): string {
  return Deno.env.get(key) ?? fallback;
}
