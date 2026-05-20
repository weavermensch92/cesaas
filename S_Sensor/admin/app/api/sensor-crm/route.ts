// /api/sensor-crm — crm_definitions CRUD (super_admin / admin only).
//   GET    /api/sensor-crm           → 전체 목록
//   POST   /api/sensor-crm           → upsert (id 충돌 시 갱신)
//   DELETE /api/sensor-crm?id=...    → 삭제 (FK: captures.crm_id 참조 시 보호)
//
// Body 스키마 (POST):
//   id              string (kebab-case)
//   name            string
//   description?    string
//   host_pattern    string   (regex)
//   match_patterns  string[] (Chrome MV3 match pattern)
//   capture_paths   string[] (pathname prefix)
//   screen_patterns Array<{ screen, url_regex, entity_extract_group? }>
//   status          'active' | 'beta' | 'deprecated'

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class ApiErr extends Error {
  status: number; code: string;
  constructor(status: number, code: string, msg: string) { super(msg); this.status = status; this.code = code; }
}
function errJson(e: unknown): NextResponse {
  if (e instanceof ApiErr) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  return NextResponse.json({ error: 'internal_error', message: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

async function requireAdmin(req: NextRequest): Promise<void> {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) throw new ApiErr(401, 'unauthorized', 'missing Bearer token');
  const sb = getServiceRoleClient();
  const { data: u, error } = await sb.auth.getUser(h.slice(7));
  if (error || !u?.user) throw new ApiErr(401, 'invalid_token', error?.message || 'no user');
  const { data: prof } = await sb.rpc('get_user_profile_for', { p_user_id: u.user.id });
  const row = Array.isArray(prof) ? prof[0] : prof;
  const role = row?.role || 'regular';
  if (role !== 'super_admin' && role !== 'admin') {
    throw new ApiErr(403, 'forbidden', `admin role required (got ${role})`);
  }
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const ALLOWED_STATUS = new Set(['active', 'beta', 'deprecated']);

interface ScreenPattern {
  screen: string;
  url_regex: string;
  entity_extract_group?: number;
}

interface CrmInput {
  id: string;
  name: string;
  description?: string | null;
  host_pattern: string;
  match_patterns: string[];
  capture_paths: string[];
  screen_patterns: ScreenPattern[];
  status?: string;
}

function validateCrm(raw: unknown): CrmInput {
  if (!raw || typeof raw !== 'object') throw new ApiErr(400, 'bad_request', 'body must be JSON object');
  const b = raw as Record<string, unknown>;

  const id = String(b.id || '').trim();
  if (!ID_RE.test(id)) throw new ApiErr(400, 'bad_request', `id must match ${ID_RE} (got "${id}")`);

  const name = String(b.name || '').trim();
  if (!name) throw new ApiErr(400, 'bad_request', 'name required');

  const host_pattern = String(b.host_pattern || '').trim();
  if (!host_pattern) throw new ApiErr(400, 'bad_request', 'host_pattern required');
  try { new RegExp(host_pattern); } catch (e) {
    throw new ApiErr(400, 'bad_request', `host_pattern invalid regex: ${(e as Error).message}`);
  }

  const match_patterns = Array.isArray(b.match_patterns) ? b.match_patterns.map(String).map((s) => s.trim()).filter(Boolean) : [];
  if (match_patterns.length === 0) throw new ApiErr(400, 'bad_request', 'match_patterns required (Chrome MV3 글로브 ≥1)');
  for (const m of match_patterns) {
    if (!/^https?:\/\/[^/]+\/.*/.test(m) && m !== '<all_urls>') {
      throw new ApiErr(400, 'bad_request', `match_patterns 항목 형식 오류: "${m}" — 예: https://*.example.com/*`);
    }
  }

  const capture_paths = Array.isArray(b.capture_paths) ? b.capture_paths.map(String).map((s) => s.trim()).filter(Boolean) : [];
  if (capture_paths.length === 0) capture_paths.push('/');
  for (const p of capture_paths) {
    if (!p.startsWith('/')) throw new ApiErr(400, 'bad_request', `capture_paths 항목은 "/"로 시작해야 함: "${p}"`);
  }

  if (!Array.isArray(b.screen_patterns) || b.screen_patterns.length === 0) {
    throw new ApiErr(400, 'bad_request', 'screen_patterns ≥1 required');
  }
  const screen_patterns: ScreenPattern[] = [];
  for (const it of b.screen_patterns as unknown[]) {
    if (!it || typeof it !== 'object') throw new ApiErr(400, 'bad_request', 'screen_patterns 항목은 object');
    const o = it as Record<string, unknown>;
    const screen = String(o.screen || '').trim();
    const url_regex = String(o.url_regex || '').trim();
    if (!screen) throw new ApiErr(400, 'bad_request', 'screen_patterns[].screen required');
    if (!url_regex) throw new ApiErr(400, 'bad_request', `screen_patterns[${screen}].url_regex required`);
    try { new RegExp(url_regex); } catch (e) {
      throw new ApiErr(400, 'bad_request', `screen_patterns[${screen}].url_regex invalid: ${(e as Error).message}`);
    }
    const out: ScreenPattern = { screen, url_regex };
    if (o.entity_extract_group != null) {
      const g = Number(o.entity_extract_group);
      if (!Number.isInteger(g) || g < 1) throw new ApiErr(400, 'bad_request', `screen_patterns[${screen}].entity_extract_group must be int ≥1`);
      out.entity_extract_group = g;
    }
    screen_patterns.push(out);
  }

  const status = b.status ? String(b.status) : 'active';
  if (!ALLOWED_STATUS.has(status)) throw new ApiErr(400, 'bad_request', `status must be one of ${[...ALLOWED_STATUS].join('/')}`);

  const description = b.description == null ? null : String(b.description).trim() || null;

  return { id, name, description, host_pattern, match_patterns, capture_paths, screen_patterns, status };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sb = getServiceRoleClient();
    const { data, error } = await sb
      .from('crm_definitions')
      .select('id, name, description, host_pattern, match_patterns, capture_paths, screen_patterns, version, status, created_at, updated_at')
      .order('created_at', { ascending: true });
    if (error) throw new ApiErr(500, 'internal_error', error.message);
    return NextResponse.json({ data });
  } catch (e) {
    return errJson(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const v = validateCrm(body);
    const sb = getServiceRoleClient();

    const { data: existing } = await sb.from('crm_definitions').select('id, version').eq('id', v.id).maybeSingle();
    const nextVersion = (existing?.version ?? 0) + 1;

    const { data, error } = await sb
      .from('crm_definitions')
      .upsert({
        id: v.id,
        name: v.name,
        description: v.description,
        host_pattern: v.host_pattern,
        match_patterns: v.match_patterns,
        capture_paths: v.capture_paths,
        screen_patterns: v.screen_patterns,
        status: v.status,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new ApiErr(500, 'internal_error', error.message);
    return NextResponse.json({ data });
  } catch (e) {
    return errJson(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!id) throw new ApiErr(400, 'bad_request', 'id query param required');

    const sb = getServiceRoleClient();
    // FK 보호 — captures.crm_id 참조 시 거절. count로 사전 차단해서 에러 메시지 친절하게.
    const { count, error: cErr } = await sb
      .from('captures')
      .select('id', { count: 'exact', head: true })
      .eq('crm_id', id);
    if (cErr) throw new ApiErr(500, 'internal_error', cErr.message);
    if ((count ?? 0) > 0) {
      throw new ApiErr(409, 'in_use', `captures가 ${count}건 참조 중 — 삭제 대신 status를 deprecated로 전환 권장`);
    }

    const { error } = await sb.from('crm_definitions').delete().eq('id', id);
    if (error) throw new ApiErr(500, 'internal_error', error.message);
    return NextResponse.json({ status: 'deleted', id });
  } catch (e) {
    return errJson(e);
  }
}
