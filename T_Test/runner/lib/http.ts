import { CONFIG } from './config.js';

export interface HttpResponse {
  status: number;
  ok: boolean;
  bodyText: string;
  bodyJson: unknown;
  durationMs: number;
  headers: Record<string, string>;
}

export async function http(args: {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;            // 함수 base 안에서의 path
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}): Promise<HttpResponse> {
  const url = `${CONFIG.apiBase}${args.path}`;
  const start = Date.now();
  const init: RequestInit = { method: args.method };
  if (args.headers) init.headers = args.headers;
  if (args.body !== undefined) init.body = args.body as BodyInit;
  const res = await fetch(url, init);
  const durationMs = Date.now() - start;
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  const hdrs: Record<string, string> = {};
  res.headers.forEach((v, k) => { hdrs[k] = v; });
  return { status: res.status, ok: res.ok, bodyText: text, bodyJson: json, durationMs, headers: hdrs };
}
