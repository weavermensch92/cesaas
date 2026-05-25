// POST /api/sensor-keys/issue — Sensor Extension 키 발급 + ZIP 다운로드
//
// Auth: Bearer Supabase JWT (super_admin / admin only)
// Body: { dealer_id?: string, label?: string }
// Return: application/zip with hd-sensor-{dealer_id}-{key_id}.zip

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import { getServiceRoleClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// manifest.json·crm_definitions.json은 DB에서 동적 생성 — 템플릿 파일은 무시.
const EXT_FILES_INCLUDE = [
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
];
const EXT_DIRS_INCLUDE = ['lib', 'icons'];

interface CrmDefRow {
  id: string;
  name: string;
  host_pattern: string;
  match_patterns: string[] | null;
  capture_paths: string[] | null;
  screen_patterns: unknown;
  status: string;
}

async function loadActiveCrmDefs(sb: ReturnType<typeof getServiceRoleClient>): Promise<CrmDefRow[]> {
  const { data, error } = await sb
    .from('crm_definitions')
    .select('id, name, host_pattern, match_patterns, capture_paths, screen_patterns, status')
    .in('status', ['active', 'beta'])
    .order('id', { ascending: true });
  if (error) throw new ApiErr(500, 'internal_error', 'crm_definitions load failed: ' + error.message);
  if (!data || data.length === 0) {
    throw new ApiErr(500, 'no_crm_defs', 'no active CRM definitions — register at least one via /sensor/crm');
  }
  return data as CrmDefRow[];
}

function buildManifest(crms: CrmDefRow[]): string {
  const matchSet = new Set<string>();
  for (const c of crms) {
    for (const m of (c.match_patterns || [])) matchSet.add(m);
  }
  const matches = [...matchSet];
  if (matches.length === 0) {
    throw new ApiErr(500, 'no_match_patterns', 'active CRMs have no match_patterns — manifest cannot be built');
  }

  const manifest = {
    manifest_version: 3,
    name: 'HD건설기계 Sensor',
    version: '0.3.0',
    description: 'CRM 화면을 자동 캡쳐해 HD건설기계 영업 데이터 플랫폼으로 전송합니다.',
    permissions: ['activeTab', 'storage', 'scripting', 'alarms'],
    host_permissions: matches,
    background: { service_worker: 'background.js', type: 'module' as const },
    content_scripts: [
      {
        matches,
        js: ['content.js'],
        run_at: 'document_idle' as const,
      },
    ],
    action: {
      default_popup: 'popup.html',
      default_icon: { '16': 'icons/16.png', '48': 'icons/48.png', '128': 'icons/128.png' },
    },
    icons: { '16': 'icons/16.png', '48': 'icons/48.png', '128': 'icons/128.png' },
    web_accessible_resources: [{ resources: ['crm_definitions.json'], matches: ['<all_urls>'] }],
  };
  return JSON.stringify(manifest, null, 2);
}

function buildCrmDefinitionsJson(crms: CrmDefRow[]): string {
  const out: Record<string, unknown> = {};
  for (const c of crms) {
    out[c.id] = {
      id: c.id,
      name: c.name,
      host_pattern: c.host_pattern,
      capture_paths: c.capture_paths && c.capture_paths.length ? c.capture_paths : ['/'],
      screen_patterns: c.screen_patterns ?? [],
    };
  }
  return JSON.stringify(out, null, 2);
}

// 후보 경로 (cwd 위치 다양성 대비)
function locateTemplate(): string {
  const candidates = [
    path.join(process.cwd(), 'S_Sensor', 'admin', 'public', '_ext-template'),
    path.join(process.cwd(), 'public', '_ext-template'),
    path.join(process.cwd(), '..', 'public', '_ext-template'),
  ];
  for (const p of candidates) {
    try { if (fs.statSync(p).isDirectory()) return p; } catch (_) { /* try next */ }
  }
  throw new Error(`extension template not found. cwd=${process.cwd()}, tried: ${candidates.join(' | ')}`);
}

function genKeyId(): string {
  const buf = crypto.randomBytes(6);
  return 'ext_' + buf.toString('hex'); // ext_ + 12 hex
}
function genHmac(): string {
  return crypto.randomBytes(32).toString('hex');
}

function configJs(API_BASE: string, key_id: string, hmac: string, dealer_id: string): string {
  return `// AUTO-GENERATED — DO NOT EDIT
export const CONFIG = {
  API_BASE: '${API_BASE}',
  API_KEY_ID: '${key_id}',
  HMAC_SECRET: '${hmac}',
  DEALER_ID: '${dealer_id}',
  DEBUG: false,
};
`;
}

function tokenFromAuthHeader(req: NextRequest): string | null {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

async function requireAdmin(req: NextRequest): Promise<{ sub: string; email: string; role: string }> {
  const token = tokenFromAuthHeader(req);
  if (!token) throw new ApiErr(401, 'unauthorized', 'missing Bearer token');
  const sb = getServiceRoleClient();
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u?.user) throw new ApiErr(401, 'invalid_token', error?.message || 'no user');
  const { data: prof } = await sb.rpc('get_user_profile_for', { p_user_id: u.user.id });
  const row = Array.isArray(prof) ? prof[0] : prof;
  const role = row?.role || 'regular';
  if (role !== 'super_admin' && role !== 'admin') {
    throw new ApiErr(403, 'forbidden', `admin role required (got ${role})`);
  }
  return { sub: u.user.id, email: u.user.email || '', role };
}

class ApiErr extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}

function errJson(e: unknown): NextResponse {
  if (e instanceof ApiErr) {
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  }
  const m = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: 'internal_error', message: m }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dealer_id = String(body.dealer_id || '').trim() || null;
    const label = String(body.label || '').trim() || null;

    const sb = getServiceRoleClient();
    const key_id = genKeyId();
    const hmac = genHmac();

    const { error: insErr } = await sb.from('sensor_api_keys').insert({
      key_id, secret: hmac, dealer_id, description: label,
    });
    if (insErr) throw new ApiErr(500, 'internal_error', 'INSERT failed: ' + insErr.message);

    // DB에서 active+beta CRM 정의 로드 → manifest·crm_definitions.json 동적 생성
    const crms = await loadActiveCrmDefs(sb);
    const manifestJson = buildManifest(crms);
    const crmDefinitionsJson = buildCrmDefinitionsJson(crms);

    // ZIP 빌드
    const root = locateTemplate();
    const zip = new JSZip();
    const extDir = zip.folder('extension')!;

    for (const f of EXT_FILES_INCLUDE) {
      const p = path.join(root, f);
      if (fs.existsSync(p)) extDir.file(f, fs.readFileSync(p));
    }
    for (const d of EXT_DIRS_INCLUDE) {
      const dp = path.join(root, d);
      if (!fs.existsSync(dp)) continue;
      const sub = extDir.folder(d)!;
      for (const f of fs.readdirSync(dp)) {
        const fp = path.join(dp, f);
        if (fs.statSync(fp).isFile()) sub.file(f, fs.readFileSync(fp));
      }
    }
    // 동적 파일 — manifest·crm_definitions.json (템플릿 정적 파일을 덮어쓰는 효과)
    extDir.file('manifest.json', manifestJson);
    extDir.file('crm_definitions.json', crmDefinitionsJson);

    // config.js — dynamic
    const API_BASE = (process.env['NEXT_PUBLIC_API_BASE']
      || ((process.env['NEXT_PUBLIC_SUPABASE_URL'] || '') + '/functions/v1')).replace(/\/$/, '');
    extDir.file('config.js', configJs(API_BASE, key_id, hmac, dealer_id || ''));

    // installer + readme — placeholders 치환
    const installerDir = path.join(root, '_installer');
    const issuedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const substitute = (s: string) =>
      s.replace(/__KEY_ID__/g, key_id)
       .replace(/__DEALER_ID__/g, dealer_id || '(global)')
       .replace(/__ISSUED_AT__/g, issuedAt)
       .replace(/__ISSUED_BY__/g, admin.email);

    for (const f of ['install.bat', 'install-ru.bat', 'uninstall.bat', 'uninstall-ru.bat']) {
      const p = path.join(installerDir, f);
      if (fs.existsSync(p)) zip.file(f, fs.readFileSync(p));
    }
    for (const f of ['README.txt', 'README-ru.txt']) {
      const p = path.join(installerDir, f);
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf8');
        zip.file(f, substitute(text));
      }
    }

    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const fname = `hd-sensor-${dealer_id || 'global'}-${key_id}.zip`;

    return new NextResponse(new Blob([buf as BlobPart], { type: 'application/zip' }), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${fname}"`,
        'cache-control': 'no-store',
        'x-hd-key-id': key_id,
        'x-hd-dealer-id': dealer_id || '',
      },
    });
  } catch (e) {
    return errJson(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sb = getServiceRoleClient();
    const { data, error } = await sb.from('sensor_api_keys')
      .select('key_id, dealer_id, description, created_at, revoked_at, expires_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new ApiErr(500, 'internal_error', error.message);
    return NextResponse.json({ data });
  } catch (e) {
    return errJson(e);
  }
}
