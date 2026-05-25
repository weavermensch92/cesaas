// Same-origin proxy → Supabase Edge Functions.
//
// 러시아 도달성: `*.supabase.co`는 Cloudflare fronting이라 MTS RUS 등 일부 ISP에서 차단됨.
// dealer/visitor 브라우저는 `/api/edge/<fn>` 같은 origin(hd-poc-admin.fly.dev, Fly Tokyo 직배)으로
// 호출하고, 서버 → Supabase 통신은 Fly 백엔드에서 일어남.
//
// 메서드·쿼리·헤더(Authorization·Idempotency-Key 등)·바디를 그대로 전달.
// 응답 바디는 stream으로 패스. CORS 헤더와 Cloudflare hop 헤더는 strip.

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM_BASE = (
  process.env['NEXT_PUBLIC_API_BASE']
    || (process.env['SUPABASE_URL'] ? `${process.env['SUPABASE_URL']}/functions/v1` : '')
    || (process.env['NEXT_PUBLIC_SUPABASE_URL'] ? `${process.env['NEXT_PUBLIC_SUPABASE_URL']}/functions/v1` : '')
).replace(/\/$/, '');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
  'host', 'content-length', 'accept-encoding',
]);

const RESP_STRIP = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection',
  'set-cookie', 'cf-ray', 'cf-cache-status', 'alt-svc', 'server',
  'access-control-allow-origin', 'access-control-allow-methods',
  'access-control-allow-headers', 'access-control-expose-headers',
  'access-control-max-age', 'access-control-allow-credentials',
]);

async function proxy(req: NextRequest, ctx: { params: { path?: string[] } }): Promise<Response> {
  if (!UPSTREAM_BASE) {
    return NextResponse.json(
      { error: 'configuration_error', message: 'NEXT_PUBLIC_API_BASE not set' },
      { status: 500 },
    );
  }
  const segs = ctx.params.path || [];
  if (segs.length === 0) {
    return NextResponse.json({ error: 'bad_request', message: 'missing function name' }, { status: 400 });
  }
  const target = `${UPSTREAM_BASE}/${segs.join('/')}${req.nextUrl.search}`;

  const upstreamHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) upstreamHeaders.set(key, value);
  });

  const init: RequestInit = {
    method: req.method,
    headers: upstreamHeaders,
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(target, init);
  } catch (e) {
    return NextResponse.json(
      { error: 'upstream_unreachable', message: e instanceof Error ? e.message : String(e), target },
      { status: 502 },
    );
  }

  const respHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (!RESP_STRIP.has(key.toLowerCase())) respHeaders.set(key, value);
  });

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: respHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
