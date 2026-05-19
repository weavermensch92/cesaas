// fly_edge/main.ts — Fly.io Edge fallback HTTP 서버 (T_07.01).
//
// 본 서버는 부스 critical path만 mirror — 러시아 측 Supabase Edge 도달성 실패 시 대체.
// 동일 DB(Supabase Tokyo)에 write — 데이터 정합성은 idempotency_key + 트랜잭션 RPC가 보장.
//
// 현재 mirror 대상 (Phase 1):
//   - POST /responses-receive (V_Voice/backend/functions/responses-receive/handler.ts)
//
// 후속 (Phase 2 — 별도 세션):
//   - POST /captures-chunks      (S_Sensor)
//   - POST /captures-finalize    (S_Sensor)
//   - GET  /dealer-consultations (V_Voice)
//
// 환경:
//   - SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · VOICE_JWT_SECRET · VOICE_JWT_ISSUER
//   - LOG_LEVEL (선택)
//   - PORT (Fly.io 자동 — 기본 8080)

import { handle as responsesReceive } from '../V_Voice/backend/functions/responses-receive/handler.ts';

const PORT = Number(Deno.env.get('PORT') ?? 8080);
const REGION = Deno.env.get('FLY_REGION') ?? 'local';
const ALLOC_ID = Deno.env.get('FLY_ALLOC_ID') ?? 'local';

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  // Supabase Edge URL 패턴: /functions/v1/<name>
  // Fly URL 패턴: 다양한 클라이언트가 어느 쪽이든 호출 가능하게 양쪽 등록
  '/responses-receive': responsesReceive,
  '/v1/responses-receive': responsesReceive,
  '/functions/v1/responses-receive': responsesReceive,
};

Deno.serve({ port: PORT, hostname: '0.0.0.0' }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Health / root
  if (path === '/health' || path === '/') {
    return jsonResponse(200, {
      ok: true,
      service: 'hd-poc-edge',
      role: 'fly_io_fallback',
      region: REGION,
      alloc_id: ALLOC_ID,
      endpoints: Object.keys(ROUTES).filter((p) => !p.includes('functions/v1')),
      ts: new Date().toISOString(),
    });
  }

  const handler = ROUTES[path];
  if (!handler) {
    return jsonResponse(404, {
      error: 'not_found',
      path,
      service: 'hd-poc-edge',
      hint: 'Available endpoints listed at /health',
    });
  }

  try {
    return await handler(req);
  } catch (err) {
    // 핸들러는 자체 try/catch → toJsonResponse를 하지만, 그래도 마지막 안전망
    console.error(JSON.stringify({
      level: 'error', msg: 'fly_edge unhandled exception', path,
      reason: err instanceof Error ? err.message : String(err),
    }));
    return jsonResponse(500, { error: 'internal_error', message: 'fly_edge unhandled' });
  }
});

console.log(JSON.stringify({
  level: 'info', msg: 'fly_edge started', port: PORT, region: REGION,
  routes: Object.keys(ROUTES).filter((p) => !p.includes('functions/v1')),
}));
