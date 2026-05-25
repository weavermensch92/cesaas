'use client';
// /sensor/crm — CRM 매트릭스 등록·수정 (crm_definitions).
//
// 흐름:
//   0) (옵션) "URL → AI 추론" — admin-crm-suggest Edge Function (web_search) → 전 필드 prefill + 인용 출처 노출
//   1) "도메인 마법사" — hosts·capture_paths 입력 → host_pattern·match_patterns 자동 계산
//   2) 자동값을 "고급" 영역에서 검토·수정 가능
//   3) screen_patterns JSON 입력 (예시 prefilled)
//   4) 저장 → 즉시 목록 갱신. 발급 ZIP은 active+beta CRM 전부를 매니페스트에 포함.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate, isAdminRole } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import type { MeProfile } from '@/lib/api';

const LANG: Lang = 'ko';

const FUNCTIONS_BASE =
  process.env['NEXT_PUBLIC_API_BASE'] ??
  (process.env['NEXT_PUBLIC_SUPABASE_URL']
    ? `${process.env['NEXT_PUBLIC_SUPABASE_URL']}/functions/v1`
    : '');

interface ScreenPattern {
  screen: string;
  url_regex: string;
  entity_extract_group?: number;
}

interface CrmRow {
  id: string;
  name: string;
  description: string | null;
  host_pattern: string;
  match_patterns: string[];
  capture_paths: string[];
  screen_patterns: ScreenPattern[];
  version: number;
  status: 'active' | 'beta' | 'deprecated';
  created_at: string;
  updated_at: string;
}

const EXAMPLE_SCREEN_PATTERNS = `[
  { "screen": "deal_list",   "url_regex": "^/crm/deal/?(\\\\?.*)?$" },
  { "screen": "deal_detail", "url_regex": "^/crm/deal/details/(\\\\d+)/?$", "entity_extract_group": 1 }
]`;

export default function CrmDefinitionsPage() {
  return <AuthGate>{({ session, me }) => <View email={session.user.email ?? ''} me={me} />}</AuthGate>;
}

function View({ email, me }: { email: string; me: MeProfile }) {
  const signOut = () => { getSupabase().auth.signOut(); };
  const admin = isAdminRole(me.role);

  const [rows, setRows] = useState<CrmRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 폼 상태
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'active' | 'beta' | 'deprecated'>('active');

  // 마법사 입력 (hosts·paths) — 한 줄에 하나
  const [hostsText, setHostsText] = useState(''); // e.g. *.example.com\nexample.crm.com
  const [pathsText, setPathsText] = useState('/');

  // 자동 계산되는 고급 값 (편집 가능)
  const [hostPattern, setHostPattern] = useState('');
  const [matchPatternsText, setMatchPatternsText] = useState(''); // 한 줄에 하나
  const [autoSync, setAutoSync] = useState(true); // 마법사 입력 변경 시 고급값 자동 덮어쓰기

  const [screenPatternsText, setScreenPatternsText] = useState(EXAMPLE_SCREEN_PATTERNS);

  // AI 추론 — URL 한 줄 → 전 필드 prefill
  const [suggestUrl, setSuggestUrl] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestCitations, setSuggestCitations] = useState<Array<{ url: string; title?: string }>>([]);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  // 인증 fetch
  const authedFetch = useCallback(async (init: RequestInit = {}) => {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('not signed in');
    return { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } };
  }, []);

  async function runAiSuggest() {
    const url = suggestUrl.trim();
    if (!url) { setErr('URL을 입력하세요'); return; }
    setSuggesting(true); setErr(null); setMsg(null); setSuggestCitations([]); setSuggestNote(null);
    try {
      if (!FUNCTIONS_BASE) throw new Error('NEXT_PUBLIC_API_BASE 또는 NEXT_PUBLIC_SUPABASE_URL 미설정');
      const init = await authedFetch();
      const r = await fetch(`${FUNCTIONS_BASE}/admin-crm-suggest`, {
        ...init,
        method: 'POST',
        headers: { ...init.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const d = await r.json();
      const s = d.suggestion as {
        id: string; name: string; description: string | null;
        host_pattern: string; match_patterns: string[]; capture_paths: string[];
        screen_patterns: ScreenPattern[];
        confidence?: number | null; confidence_note?: string | null;
      };
      setId(s.id);
      setName(s.name);
      setDescription(s.description || '');
      setHostPattern(s.host_pattern);
      setMatchPatternsText((s.match_patterns || []).join('\n'));
      setPathsText((s.capture_paths && s.capture_paths.length ? s.capture_paths : ['/']).join('\n'));
      setScreenPatternsText(JSON.stringify(s.screen_patterns || [], null, 2));
      setStatus('beta');           // 사람이 검수하도록 beta 기본
      setAutoSync(false);          // AI 추론값 보존
      setHostsText('');            // 마법사 입력은 비움 (자동 sync 꺼져있어 영향 없음)
      const cs = Array.isArray(d.citations) ? d.citations : [];
      setSuggestCitations(cs);
      const confStr = typeof s.confidence === 'number' ? ` · confidence ${s.confidence.toFixed(2)}` : '';
      const note = s.confidence_note ? ` · ${s.confidence_note}` : '';
      setSuggestNote(`prompt ${d.prompt_version || '?'} · model ${d.model || '?'}${confStr}${note}`);
      setMsg(`AI 추론 적용 완료 — 검수 후 저장하세요 (status=beta 권장)`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSuggesting(false); }
  }

  const refresh = useCallback(async () => {
    if (!admin) return;
    setLoading(true); setErr(null);
    try {
      const init = await authedFetch();
      const r = await fetch('/api/sensor-crm', init);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const d = await r.json();
      setRows(d.data || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [admin, authedFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  // 마법사 자동 계산
  const wizardResult = useMemo(() => {
    const hosts = hostsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const paths = pathsText.split('\n').map((s) => s.trim()).filter(Boolean);
    return computeWizard(hosts, paths.length ? paths : ['/']);
  }, [hostsText, pathsText]);

  useEffect(() => {
    if (!autoSync) return;
    setHostPattern(wizardResult.hostPattern);
    setMatchPatternsText(wizardResult.matchPatterns.join('\n'));
  }, [autoSync, wizardResult]);

  function resetForm() {
    setId(''); setName(''); setDescription(''); setStatus('active');
    setHostsText(''); setPathsText('/');
    setHostPattern(''); setMatchPatternsText('');
    setScreenPatternsText(EXAMPLE_SCREEN_PATTERNS);
    setAutoSync(true);
  }

  function loadRowIntoForm(r: CrmRow) {
    setId(r.id);
    setName(r.name);
    setDescription(r.description || '');
    setStatus(r.status);
    setHostsText(''); // 원본 마법사 입력은 재구성 불가 — 빈칸으로 두고 고급값 그대로 사용
    setPathsText((r.capture_paths || ['/']).join('\n'));
    setHostPattern(r.host_pattern);
    setMatchPatternsText((r.match_patterns || []).join('\n'));
    setScreenPatternsText(JSON.stringify(r.screen_patterns || [], null, 2));
    setAutoSync(false); // 편집 모드에서는 자동 sync 꺼서 사용자 값 보존
    setMsg(`수정 모드: ${r.id} (저장 시 upsert)`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErr(null);
    try {
      let screen_patterns: ScreenPattern[];
      try { screen_patterns = JSON.parse(screenPatternsText); }
      catch (parseErr) { throw new Error(`screen_patterns JSON 파싱 실패: ${(parseErr as Error).message}`); }

      const match_patterns = matchPatternsText.split('\n').map((s) => s.trim()).filter(Boolean);
      const capture_paths  = pathsText.split('\n').map((s) => s.trim()).filter(Boolean);

      const init = await authedFetch();
      const r = await fetch('/api/sensor-crm', {
        ...init,
        method: 'POST',
        headers: { ...init.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id.trim(),
          name: name.trim(),
          description: description.trim() || null,
          host_pattern: hostPattern.trim(),
          match_patterns,
          capture_paths,
          screen_patterns,
          status,
        }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const d = await r.json();
      setMsg(`저장 완료 · ${d.data.id} (v${d.data.version})`);
      resetForm();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function remove(targetId: string) {
    if (!confirm(`정말 삭제? id="${targetId}". captures가 참조 중이면 거절됩니다.`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const init = await authedFetch();
      const r = await fetch(`/api/sensor-crm?id=${encodeURIComponent(targetId)}`, { ...init, method: 'DELETE' });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setMsg(`삭제 완료 · ${targetId}`);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!admin) {
    return (
      <>
        <TopBar lang={LANG} email={email} onSignOut={signOut} />
        <SectionNav />
        <main style={{ padding: 18 }}>
          <div className="hd-card" style={{ padding: 18 }}>
            <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>접근 권한 없음</h2>
            <p className="hd-meta">CRM 매트릭스 관리는 Admin / Super Admin 만 가능합니다.</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />
      <main style={{ padding: 18, display: 'grid', gap: 18 }}>
        {err && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-red)' }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}
        {msg && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-green)' }}>
            <span className="hd-meta" style={{ color: 'var(--hd-green)' }}>{msg}</span>
          </div>
        )}

        <div className="hd-card" style={{ padding: 18 }}>
          <h2 className="hd-h2" style={{ margin: 0, marginBottom: 6 }}>CRM 매트릭스 등록</h2>
          <p className="hd-meta" style={{ marginBottom: 14 }}>
            새 CRM을 등록하면 다음 발급 ZIP부터 매니페스트 <code>host_permissions</code>와 <code>crm_definitions.json</code>에 자동 포함됩니다.
            기존 사용자가 Extension을 재설치해야 적용됨에 유의.
          </p>

          {/* Row 0 — URL → AI 추론 */}
          <fieldset style={{ border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', padding: 12, marginBottom: 14 }}>
            <legend className="hd-eyebrow" style={{ padding: '0 6px' }}>URL → AI 추론 (web search)</legend>
            <p className="hd-meta" style={{ marginTop: 0, marginBottom: 8 }}>
              CRM 한 URL만 입력하면 web_search로 공식 URL 구조를 조사하여 ID·name·host_pattern·match_patterns·capture_paths·screen_patterns 전부를 채웁니다.
              결과는 <code>status=beta</code>로 prefill — 사람이 검수 후 저장하세요.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url" value={suggestUrl} onChange={(e) => setSuggestUrl(e.target.value)}
                placeholder="https://amocrm.example.com/leads/detail/12345"
                style={{ ...inputStyle, flex: 1, fontFamily: 'var(--hd-mono, monospace)' }}
              />
              <button type="button" className="hd-btn primary" onClick={runAiSuggest} disabled={suggesting || !suggestUrl.trim()}>
                {suggesting ? '추론 중…' : 'AI 추론'}
              </button>
            </div>
            {suggestNote && (
              <p className="hd-meta" style={{ marginTop: 8 }}>{suggestNote}</p>
            )}
            {suggestCitations.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span className="hd-eyebrow">참고 출처 ({suggestCitations.length})</span>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {suggestCitations.slice(0, 10).map((c, i) => (
                    <li key={i} style={{ fontSize: 12 }}>
                      <a href={c.url} target="_blank" rel="noreferrer">{c.title || c.url}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>

          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            {/* Row 1 — 기본 메타 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 160px', gap: 8 }}>
              <Field label="ID (kebab-case)*">
                <input value={id} onChange={(e) => setId(e.target.value)} placeholder="amocrm" style={inputStyle} />
              </Field>
              <Field label="Name*">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="amoCRM" style={inputStyle} />
              </Field>
              <Field label="Description (옵션)">
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="러시아 amoCRM 인스턴스" style={inputStyle} />
              </Field>
              <Field label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'beta' | 'deprecated')} style={inputStyle}>
                  <option value="active">active</option>
                  <option value="beta">beta</option>
                  <option value="deprecated">deprecated</option>
                </select>
              </Field>
            </div>

            {/* Row 2 — 마법사 */}
            <fieldset style={{ border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', padding: 12 }}>
              <legend className="hd-eyebrow" style={{ padding: '0 6px' }}>도메인 마법사</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Hosts (한 줄에 하나 · *. 와일드카드 허용)*">
                  <textarea
                    value={hostsText} onChange={(e) => setHostsText(e.target.value)}
                    placeholder={'*.amocrm.ru\namocrm.example.com'}
                    rows={3} style={{ ...inputStyle, height: 'auto', padding: 8, fontFamily: 'var(--hd-mono, monospace)' }}
                  />
                </Field>
                <Field label="Capture paths (pathname prefix, 한 줄에 하나)">
                  <textarea
                    value={pathsText} onChange={(e) => setPathsText(e.target.value)}
                    placeholder={'/leads/\n/contacts/'}
                    rows={3} style={{ ...inputStyle, height: 'auto', padding: 8, fontFamily: 'var(--hd-mono, monospace)' }}
                  />
                </Field>
              </div>
              <label className="hd-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
                마법사 입력으로 host_pattern·match_patterns 자동 채우기 (끄면 고급 영역 값 보존)
              </label>
            </fieldset>

            {/* Row 3 — 고급 */}
            <fieldset style={{ border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', padding: 12 }}>
              <legend className="hd-eyebrow" style={{ padding: '0 6px' }}>고급 — 자동 생성값 (편집 가능)</legend>
              <Field label="host_pattern (JS RegExp, content.js URL 매칭용)*">
                <input
                  value={hostPattern} onChange={(e) => { setHostPattern(e.target.value); setAutoSync(false); }}
                  placeholder="^https://([^/]+)\\.amocrm\\.ru/"
                  style={{ ...inputStyle, fontFamily: 'var(--hd-mono, monospace)' }}
                />
              </Field>
              <Field label="match_patterns (Chrome MV3, 한 줄에 하나, manifest 주입용)*">
                <textarea
                  value={matchPatternsText} onChange={(e) => { setMatchPatternsText(e.target.value); setAutoSync(false); }}
                  placeholder={'https://*.amocrm.ru/*'}
                  rows={3} style={{ ...inputStyle, height: 'auto', padding: 8, fontFamily: 'var(--hd-mono, monospace)' }}
                />
              </Field>
            </fieldset>

            {/* Row 4 — screen_patterns */}
            <Field label="screen_patterns (JSON 배열 — 화면 분류 + entity_id 정규식)*">
              <textarea
                value={screenPatternsText} onChange={(e) => setScreenPatternsText(e.target.value)}
                rows={8} style={{ ...inputStyle, height: 'auto', padding: 8, fontFamily: 'var(--hd-mono, monospace)' }}
              />
            </Field>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="hd-btn primary" disabled={busy}>
                {busy ? '저장 중…' : '저장 (upsert)'}
              </button>
              <button type="button" className="hd-btn" onClick={resetForm} disabled={busy}>폼 초기화</button>
            </div>
          </form>
        </div>

        <div className="hd-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="hd-h2" style={{ margin: 0 }}>등록된 CRM</h2>
            <span style={{ flex: 1 }} />
            {loading && <span className="hd-meta">로딩…</span>}
            <button className="hd-btn sm" onClick={refresh}>새로고침</button>
          </div>
          <table className="hd-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>ID</th><th>Name</th><th>match_patterns</th><th>screens</th><th>v</th><th>status</th><th>수정</th><th>삭제</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="hd-num">{r.id}</td>
                  <td>{r.name}</td>
                  <td className="hd-meta" style={{ fontFamily: 'var(--hd-mono, monospace)', fontSize: 12 }}>
                    {(r.match_patterns || []).join(', ')}
                  </td>
                  <td className="hd-num">{(r.screen_patterns || []).length}</td>
                  <td className="hd-num">{r.version}</td>
                  <td>
                    {r.status === 'active'
                      ? <span className="hd-badge green">active</span>
                      : r.status === 'beta'
                        ? <span className="hd-badge ghost">beta</span>
                        : <span className="hd-badge red">deprecated</span>}
                  </td>
                  <td><button className="hd-btn sm" onClick={() => loadRowIntoForm(r)}>편집</button></td>
                  <td><button className="hd-btn sm" onClick={() => remove(r.id)} disabled={busy}>삭제</button></td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="hd-meta" style={{ textAlign: 'center', padding: 18 }}>등록된 CRM 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

// ---------- 도메인 마법사 변환 ----------

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 와일드카드 host → regex 조각.
 *   "*.foo.com"   → "[^/]+\\.foo\\.com"
 *   "crm.foo.com" → "crm\\.foo\\.com"
 *   "foo.com"     → "foo\\.com"
 */
function hostToRegex(host: string): string {
  if (host.startsWith('*.')) {
    const rest = host.slice(2);
    return `[^/]+\\.${rest.split('.').map(escapeRegexLiteral).join('\\.')}`;
  }
  return host.split('.').map(escapeRegexLiteral).join('\\.');
}

function computeWizard(hosts: string[], paths: string[]): {
  hostPattern: string;
  matchPatterns: string[];
} {
  if (hosts.length === 0) return { hostPattern: '', matchPatterns: [] };
  const hostAlt = hosts.map(hostToRegex).join('|');
  const hostPattern = hosts.length === 1
    ? `^https://${hostAlt}/`
    : `^https://(${hostAlt})/`;

  const matchPatterns: string[] = [];
  for (const h of hosts) {
    for (const p of paths) {
      // capture_paths가 "/"면 전체, "/crm/" 같으면 prefix*
      const suffix = p === '/' ? '*' : `${p.replace(/\/$/, '')}/*`;
      matchPatterns.push(`https://${h}/${suffix.replace(/^\//, '')}`);
    }
  }
  return { hostPattern, matchPatterns };
}

// ---------- 공통 스타일 ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label className="hd-eyebrow" style={{ marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', color: 'var(--hd-ink)', background: 'transparent',
};
