// POST /api/dealers/delete — 딜러 삭제 (토큰·키 cascade, responses 유지)
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEALER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const token = auth.slice(7);
    const sb = getServiceRoleClient();
    const { data: u, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !u?.user) return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    const { data: prof } = await sb.rpc('get_user_profile_for', { p_user_id: u.user.id });
    const role = (Array.isArray(prof) ? prof[0] : prof)?.role || 'regular';
    if (role !== 'super_admin' && role !== 'admin') {
      return NextResponse.json({ error: 'forbidden', message: 'admin role required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dealer_id = String(body.dealer_id ?? '').trim().toLowerCase();
    if (!DEALER_ID_RE.test(dealer_id)) {
      return NextResponse.json({ error: 'validation_failed', message: 'dealer_id 형식' }, { status: 400 });
    }

    const { data, error } = await sb.rpc('delete_dealer', { p_dealer_id: dealer_id });
    if (error) return NextResponse.json({ error: 'internal_error', message: error.message }, { status: 500 });
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      dealer_id,
      deleted_voice_tokens: row?.deleted_voice_tokens ?? 0,
      deleted_sensor_keys:  row?.deleted_sensor_keys  ?? 0,
      dealer_removed:       Boolean(row?.dealer_removed),
      actor: u.user.email,
    });
  } catch (e) {
    return NextResponse.json({ error: 'internal_error', message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
