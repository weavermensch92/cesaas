// Dealer Bearer JWT 발급 (테스트용) — R_20.lib.issueToken의 sign-only 버전.
import { SignJWT } from 'jose';
import { CONFIG } from './config.js';
import { randomUUID } from 'node:crypto';

export async function signDealerToken(args: {
  dealerId: string;
  event?: string;
  ttlHours?: number;
}): Promise<{ jwt: string; jti: string; exp: number }> {
  if (!CONFIG.jwtSecret) throw new Error('VOICE_JWT_SECRET missing — Voice E2E unavailable');
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (args.ttlHours ?? 1) * 3600;
  const jwt = await new SignJWT({ role: 'dealer', event: args.event ?? CONFIG.event })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(CONFIG.jwtIssuer)
    .setSubject(args.dealerId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(CONFIG.jwtSecret));
  return { jwt, jti, exp };
}
