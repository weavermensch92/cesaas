// POST /api/dealers/issue — 통합 딜러 등록
//   1) dealers row upsert (소속회사 등 메타 포함)
//   2) Voice Bearer JWT 발급 (기존 dealer-tokens-issue Edge fn 호출)
//   3) Sensor HMAC + sensor_api_keys row
//   4) ZIP: extension + installer(ko/ru) + dealer-info.html 카드
// 응답: ZIP 바이너리 + 메타 헤더 (X-HD-VOICE-URL · X-HD-VOICE-JTI · X-HD-SENSOR-KEY-ID · X-HD-DEALER-ID)

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import { getServiceRoleClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEALER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const EVENT_RE     = /^[a-z0-9][a-z0-9_-]{1,63}$/;

const EXT_FILES = ['manifest.json','background.js','content.js','popup.html','popup.js','crm_definitions.json'];
const EXT_DIRS  = ['lib','icons'];

function locateTemplate(): string {
  const candidates = [
    path.join(process.cwd(), 'S_Sensor', 'admin', 'public', '_ext-template'),
    path.join(process.cwd(), 'public', '_ext-template'),
    path.join(process.cwd(), '..', 'public', '_ext-template'),
  ];
  for (const p of candidates) { try { if (fs.statSync(p).isDirectory()) return p; } catch (_) {} }
  throw new Error('extension template not found');
}

class ApiErr extends Error {
  status: number; code: string;
  constructor(status: number, code: string, msg: string) { super(msg); this.status = status; this.code = code; }
}
function errJson(e: unknown): NextResponse {
  if (e instanceof ApiErr) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  return NextResponse.json({ error: 'internal_error', message: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

function bearerFromReq(req: NextRequest): string {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) throw new ApiErr(401, 'unauthorized', 'missing Bearer token');
  return h.slice(7);
}

async function requireAdmin(req: NextRequest): Promise<{ sub: string; email: string }> {
  const token = bearerFromReq(req);
  const sb = getServiceRoleClient();
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u?.user) throw new ApiErr(401, 'invalid_token', error?.message || 'no user');
  const { data: prof } = await sb.rpc('get_user_profile_for', { p_user_id: u.user.id });
  const row = Array.isArray(prof) ? prof[0] : prof;
  const role = row?.role || 'regular';
  if (role !== 'super_admin' && role !== 'admin') {
    throw new ApiErr(403, 'forbidden', `admin role required (got ${role})`);
  }
  return { sub: u.user.id, email: u.user.email || '' };
}

interface IssueBody {
  dealer_id: string;
  name: string;
  affiliation?: string;
  region?: string;
  event?: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
  ttl_hours?: number;
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Partial<IssueBody>;

    const name = String(body.name ?? '').trim();
    const event = String(body.event ?? 'ctt_moscow_2026').trim();
    if (!name)                          throw new ApiErr(400, 'validation_failed', 'name required');
    if (!EVENT_RE.test(event))          throw new ApiErr(400, 'validation_failed', 'event 형식 잘못');

    // dealer_id 시스템 발급 — 8 hex (충돌 시 3회 재시도)
    let dealer_id = '';
    for (let i = 0; i < 3; i++) {
      const candidate = 'd_' + crypto.randomBytes(4).toString('hex');
      const { data: exist } = await getServiceRoleClient()
        .from('dealers').select('dealer_id').eq('dealer_id', candidate).maybeSingle();
      if (!exist) { dealer_id = candidate; break; }
    }
    if (!dealer_id) throw new ApiErr(500, 'internal_error', 'dealer_id 발급 실패 (collision)');

    const affiliation   = body.affiliation   ? String(body.affiliation).trim()   : null;
    const region        = body.region        ? String(body.region).trim()        : null;
    const contact_email = body.contact_email ? String(body.contact_email).trim() : null;
    const contact_phone = body.contact_phone ? String(body.contact_phone).trim() : null;
    const notes         = body.notes         ? String(body.notes).trim()         : null;

    const sb = getServiceRoleClient();

    // 1) dealers upsert
    const { error: upErr } = await sb.from('dealers').upsert({
      dealer_id, name, affiliation, region, event,
      contact_email, contact_phone, notes,
      created_by: admin.email,
      status: 'active',
    }, { onConflict: 'dealer_id' });
    if (upErr) throw new ApiErr(500, 'internal_error', 'dealers upsert: ' + upErr.message);

    // 2) Voice JWT — 기존 dealer-tokens-issue Edge fn 호출 (admin Bearer 전달)
    const SUPA_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'] || process.env['SUPABASE_URL'];
    const FN_BASE = (process.env['NEXT_PUBLIC_API_BASE'] || `${SUPA_URL}/functions/v1`).replace(/\/$/, '');
    const adminToken = bearerFromReq(req);
    const ttl_hours = typeof body.ttl_hours === 'number' && body.ttl_hours > 0 ? body.ttl_hours : 24 * 30;
    const voiceRes = await fetch(`${FN_BASE}/dealer-tokens-issue`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealer_id, event, ttl_hours, label: affiliation || name }),
    });
    if (!voiceRes.ok) {
      const t = await voiceRes.text();
      throw new ApiErr(502, 'upstream_unavailable', `dealer-tokens-issue ${voiceRes.status}: ${t}`);
    }
    const voice = await voiceRes.json() as { jti: string; jwt?: string; token?: string; url?: string; expires_at?: string };
    const voiceUrl = voice.url || '';
    const voiceJti = voice.jti || '';

    // 3) Sensor HMAC
    const sensorKeyId = 'ext_' + crypto.randomBytes(6).toString('hex');
    const sensorHmac  = crypto.randomBytes(32).toString('hex');
    const { error: skErr } = await sb.from('sensor_api_keys').insert({
      key_id: sensorKeyId, secret: sensorHmac, dealer_id,
      description: `${name}${affiliation ? ' · ' + affiliation : ''}`,
    });
    if (skErr) throw new ApiErr(500, 'internal_error', 'sensor_api_keys: ' + skErr.message);

    // 4) ZIP
    const root = locateTemplate();
    const zip = new JSZip();
    const extDir = zip.folder('extension')!;
    for (const f of EXT_FILES) {
      const p = path.join(root, f);
      if (fs.existsSync(p)) extDir.file(f, fs.readFileSync(p));
    }
    for (const d of EXT_DIRS) {
      const dp = path.join(root, d);
      if (!fs.existsSync(dp)) continue;
      const sub = extDir.folder(d)!;
      for (const f of fs.readdirSync(dp)) {
        const fp = path.join(dp, f);
        if (fs.statSync(fp).isFile()) sub.file(f, fs.readFileSync(fp));
      }
    }
    // config.js
    const API_BASE_RAW = (process.env['NEXT_PUBLIC_API_BASE'] || `${SUPA_URL}/functions/v1`).replace(/\/$/, '');
    extDir.file('config.js',
      `// AUTO-GENERATED — DO NOT EDIT\nexport const CONFIG = {\n` +
      `  API_BASE: '${API_BASE_RAW}',\n` +
      `  API_KEY_ID: '${sensorKeyId}',\n` +
      `  HMAC_SECRET: '${sensorHmac}',\n` +
      `  DEALER_ID: '${dealer_id}',\n` +
      `  DEBUG: false,\n};\n`
    );

    // installer + README — placeholders 치환
    const issuedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const subst = (s: string) =>
      s.replace(/__KEY_ID__/g, sensorKeyId)
       .replace(/__DEALER_ID__/g, dealer_id)
       .replace(/__ISSUED_AT__/g, issuedAt)
       .replace(/__ISSUED_BY__/g, admin.email);
    const inst = path.join(root, '_installer');
    for (const f of ['install.bat', 'install-ru.bat', 'uninstall.bat', 'uninstall-ru.bat']) {
      const p = path.join(inst, f);
      if (fs.existsSync(p)) zip.file(f, fs.readFileSync(p));
    }
    for (const f of ['README.txt', 'README-ru.txt']) {
      const p = path.join(inst, f);
      if (fs.existsSync(p)) zip.file(f, subst(fs.readFileSync(p, 'utf8')));
    }

    // dealer-info.html — 인쇄용 카드 (QR + Voice URL + Sensor 안내)
    const qrSrc = voiceUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(voiceUrl)}` : '';
    zip.file('dealer-info.html', dealerInfoHtml({
      dealer_id, name, affiliation, region, event,
      contact_email, contact_phone, voice_url: voiceUrl, voice_jti: voiceJti,
      sensor_key_id: sensorKeyId, issued_at: issuedAt, issued_by: admin.email, qr_src: qrSrc,
    }));

    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const fname = `hd-dealer-${dealer_id}-${event}.zip`;

    return new NextResponse(new Blob([buf as BlobPart], { type: 'application/zip' }), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${fname}"`,
        'cache-control': 'no-store',
        'x-hd-dealer-id': dealer_id,
        'x-hd-voice-jti': voiceJti,
        'x-hd-voice-url': voiceUrl,
        'x-hd-sensor-key-id': sensorKeyId,
        'access-control-expose-headers': 'x-hd-dealer-id, x-hd-voice-jti, x-hd-voice-url, x-hd-sensor-key-id',
      },
    });
  } catch (e) { return errJson(e); }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sb = getServiceRoleClient();
    const { data, error } = await sb.from('dealers')
      .select('dealer_id, name, affiliation, region, event, contact_email, contact_phone, status, created_at, created_by')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new ApiErr(500, 'internal_error', error.message);
    return NextResponse.json({ data });
  } catch (e) { return errJson(e); }
}

function dealerInfoHtml(d: {
  dealer_id: string; name: string; affiliation: string | null; region: string | null; event: string;
  contact_email: string | null; contact_phone: string | null; voice_url: string; voice_jti: string;
  sensor_key_id: string; issued_at: string; issued_by: string; qr_src: string;
}): string {
  const esc = (s: string | null) => (s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>HD건설기계 · ${esc(d.dealer_id)} · 발급 정보</title>
<style>
:root { --green:#00AD1D; --blue:#003087; --ink:#002554; --gray:#63666A; --bg:#f6f8f6; --line:#d6dadf; }
*{margin:0;padding:0;box-sizing:border-box;font-family:'Noto Sans KR',sans-serif;}
body{background:var(--bg);color:var(--ink);padding:30px;}
.card{max-width:780px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);}
h1{color:var(--green);font-size:24px;margin-bottom:4px;}
h2{color:var(--blue);font-size:16px;margin-bottom:20px;border-bottom:2px solid var(--green);padding-bottom:8px;}
.meta{display:grid;grid-template-columns:120px 1fr;gap:8px 14px;margin-bottom:24px;font-size:13px;}
.meta dt{color:var(--gray);font-weight:500;}
.meta dd{color:var(--ink);font-weight:500;}
.qr{display:flex;gap:24px;align-items:flex-start;margin:20px 0;padding:20px;background:var(--bg);border-radius:8px;}
.qr img{width:200px;height:200px;border:1px solid var(--line);background:#fff;}
.qr-info{flex:1;}
.qr-info b{color:var(--blue);font-size:14px;display:block;margin-bottom:6px;}
.url{font-family:monospace;font-size:11px;color:var(--gray);word-break:break-all;background:#fff;padding:8px 10px;border:1px solid var(--line);border-radius:4px;margin-top:8px;}
.steps{list-style:none;counter-reset:s;margin:16px 0;}
.steps li{counter-increment:s;padding:8px 0 8px 36px;position:relative;font-size:13px;color:var(--ink);}
.steps li::before{content:counter(s);position:absolute;left:0;top:6px;width:24px;height:24px;background:var(--green);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);font-size:11px;color:var(--gray);}
@media print { body{background:#fff;padding:0;} .card{border:none;box-shadow:none;} }
</style></head>
<body><div class="card">
<h1>HD건설기계 · 딜러 발급 정보</h1>
<h2>${esc(d.name)}${d.affiliation ? ' · ' + esc(d.affiliation) : ''}</h2>

<dl class="meta">
  <dt>Dealer ID</dt><dd><code>${esc(d.dealer_id)}</code></dd>
  ${d.affiliation ? `<dt>소속회사</dt><dd>${esc(d.affiliation)}</dd>` : ''}
  ${d.region ? `<dt>Region</dt><dd>${esc(d.region)}</dd>` : ''}
  <dt>Event</dt><dd>${esc(d.event)}</dd>
  ${d.contact_email ? `<dt>Email</dt><dd>${esc(d.contact_email)}</dd>` : ''}
  ${d.contact_phone ? `<dt>전화</dt><dd>${esc(d.contact_phone)}</dd>` : ''}
  <dt>발급 시각</dt><dd>${esc(d.issued_at)}</dd>
  <dt>발급자</dt><dd>${esc(d.issued_by)}</dd>
</dl>

<h2>① Voice 설문 (모바일·노트북에서 사용)</h2>
<div class="qr">
  ${d.qr_src ? `<img src="${esc(d.qr_src)}" alt="QR"/>` : ''}
  <div class="qr-info">
    <b>QR 스캔 → Voice 설문 화면 진입</b>
    <p style="font-size:12px;color:var(--gray);line-height:1.6;">고객 인터뷰 시 모바일에서 이 QR을 스캔하거나 아래 URL을 입력하세요. 토큰이 만료되면 어드민에 재발급 요청.</p>
    <div class="url">${esc(d.voice_url)}</div>
    <div class="url" style="margin-top:4px;color:#999;">JTI: ${esc(d.voice_jti)}</div>
  </div>
</div>

<h2>② Sensor Chrome Extension (CRM 화면 자동 캡쳐)</h2>
<ol class="steps">
  <li>같은 ZIP 안 <code>install.bat</code> (한국인) 또는 <code>install-ru.bat</code> (러시아인) 더블클릭</li>
  <li>Chrome 자동 탐지 + 바탕화면에 "HD Sensor Chrome" 바로가기 생성</li>
  <li>바로가기 더블클릭 → 전용 Chrome 인스턴스에서 Bitrix24 접속</li>
  <li>CRM 화면 자동 캡쳐 시작 (Sensor Key: <code>${esc(d.sensor_key_id)}</code>)</li>
</ol>

<div class="footer">
  HD건설기계 영업 데이터 PoC · 본 문서를 인쇄하거나 PDF로 저장하여 보관하세요.
</div>
</div></body></html>`;
}
