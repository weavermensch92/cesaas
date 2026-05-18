/**
 * R_20 — Dealer Bearer JWT 발급 라이브러리.
 *
 * 1. JWT sign (HS256) — VOICE_JWT_SECRET 사용
 * 2. voice_dealer_tokens 테이블에 row 등록 (jti·dealer_id·event·expires_at)
 * 3. dealer URL = {DEALER_BASE}/?token={jwt}
 * 4. QR PNG/SVG 생성
 */

import { SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface IssueArgs {
  dealerId: string;
  event: string;
  /** 만료 시간 — 기본 24시간 */
  ttlHours?: number;
}

export interface IssueResult {
  jti: string;
  jwt: string;
  url: string;
  expiresAt: Date;
  pngPath: string;
  svgPath: string;
}

interface EnvConfig {
  supabaseUrl: string;
  serviceKey: string;
  jwtSecret: string;
  jwtIssuer: string;
  dealerBase: string;
  outDir: string;
}

function loadEnv(): EnvConfig {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`env missing: ${k}`);
    return v;
  };
  return {
    supabaseUrl: need('SUPABASE_URL'),
    serviceKey:  need('SUPABASE_SERVICE_ROLE_KEY'),
    jwtSecret:   need('VOICE_JWT_SECRET'),
    jwtIssuer:   process.env['VOICE_JWT_ISSUER'] ?? 'hd-poc',
    dealerBase:  need('DEALER_BASE_URL'),
    outDir:      process.env['R20_OUT_DIR'] ?? './R_Runtime/r20/out',
  };
}

export async function issueToken(args: IssueArgs): Promise<IssueResult> {
  const env = loadEnv();
  const ttlHours = args.ttlHours ?? 24;

  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlHours * 3600;

  const jwt = await new SignJWT({ role: 'dealer', event: args.event })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.jwtIssuer)
    .setSubject(args.dealerId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(env.jwtSecret));

  // DB 등록
  const supa = createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false },
  });
  const expiresAt = new Date(exp * 1000);
  const { error } = await supa.from('voice_dealer_tokens').insert({
    dealer_id: args.dealerId,
    event: args.event,
    jti,
    issued_at: new Date(now * 1000).toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (error) {
    throw new Error(`voice_dealer_tokens INSERT failed: ${error.message}`);
  }

  const url = `${env.dealerBase.replace(/\/$/, '')}/?token=${encodeURIComponent(jwt)}`;

  // QR 출력
  await mkdir(env.outDir, { recursive: true });
  const slug = sanitize(`${args.event}_${args.dealerId}`);
  const pngPath = path.resolve(env.outDir, `${slug}.png`);
  const svgPath = path.resolve(env.outDir, `${slug}.svg`);

  await QRCode.toFile(pngPath, url, {
    type: 'png',
    margin: 2,
    width: 512,
    color: { dark: '#002554', light: '#ffffff' },
  });
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 2,
    width: 512,
    color: { dark: '#002554', light: '#ffffff' },
  });
  await writeFile(svgPath, svg, 'utf8');

  return { jti, jwt, url, expiresAt, pngPath, svgPath };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
}
