'use client';
/**
 * /gridge — R_10 룰 위버 편집기.
 *
 * 위버(gridge_admin)가 yaml 디스크 편집 + publish-rule CLI 없이
 * UI에서 R_10 룰의 active body_yaml을 보고·수정·publish.
 *
 * 핵심 사용 시나리오:
 *   "자연어 입력 → 검토·편집 으로 넘어갈 때 LLM 출력을 구조화하는 규칙 수정"
 *   = R_10.06_PromptTemplates 의 voice_studio_survey_build 템플릿.
 *
 * Publish 시 DB rule_versions에 새 row INSERT (status='active'), 이전은 'archived'.
 * 60s 캐시 TTL 후 모든 Edge Function이 신규 룰 사용.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate, isAdminRole } from '../components/AuthGate';
import type { MeProfile } from '@/lib/api';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  listGridgeRules,
  getGridgeRule,
  publishGridgeRule,
  ApiClientError,
  type GridgeRuleSummary,
  type GridgeRuleDetail,
} from '@/lib/api';

const LANG: Lang = 'ko';

export default function GridgePage() {
  return <AuthGate>{({ session, me }) => <GridgeView email={session.user.email ?? ''} me={me} />}</AuthGate>;
}

function GridgeView({ email, me }: { email: string; me: MeProfile }) {
  const isAdmin = isAdminRole(me.role);
  const [rules, setRules] = useState<GridgeRuleSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GridgeRuleDetail | null>(null);
  const [editYaml, setEditYaml] = useState<string>('');
  const [editVersion, setEditVersion] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const signOut = () => { getSupabase().auth.signOut(); };

  const loadList = useCallback(async () => {
    if (!isAdmin) return;
    setListLoading(true); setErr(null);
    try {
      const { rules } = await listGridgeRules();
      setRules(rules);
      // 기본 선택: R_10.06_PromptTemplates 우선 (사용자 주 요청)
      const preferred = rules.find((r) => r.rule_id.startsWith('R_10.06_')) ?? rules[0];
      if (!selectedId && preferred) {
        setSelectedId(preferred.rule_id);
      }
    } catch (e) {
      setErr(formatErr(e));
    } finally { setListLoading(false); }
  }, [isAdmin, selectedId]);

  const loadDetail = useCallback(async (ruleId: string) => {
    setDetailLoading(true); setErr(null); setOkMsg(null);
    try {
      const d = await getGridgeRule(ruleId);
      setDetail(d);
      setEditYaml(d.body_yaml);
      setEditVersion(''); // 빈값 = YAML version: 필드 사용
      setNotes('');
    } catch (e) {
      setErr(formatErr(e));
      setDetail(null);
      setEditYaml('');
    } finally { setDetailLoading(false); }
  }, []);

  useEffect(() => { loadList().catch(() => {}); }, [loadList]);
  useEffect(() => {
    if (selectedId) loadDetail(selectedId).catch(() => {});
  }, [selectedId, loadDetail]);

  const dirty = useMemo(() => detail != null && editYaml !== detail.body_yaml, [detail, editYaml]);
  const yamlVersionInBody = useMemo(() => extractYamlVersion(editYaml), [editYaml]);
  const effectiveVersion = (editVersion.trim() || yamlVersionInBody || '').trim();
  const sameAsActive = detail != null && effectiveVersion === detail.version;

  const submit = async () => {
    if (!detail) return;
    if (!effectiveVersion) { setErr('version 필요 — YAML 안의 version: 필드를 bump 하거나 입력란에 명시'); return; }
    if (sameAsActive) { setErr(`version "${effectiveVersion}" 은(는) 현재 active와 동일 — bump 필요`); return; }
    setPublishing(true); setErr(null); setOkMsg(null);
    try {
      const r = await publishGridgeRule({
        rule_id: detail.rule_id,
        body_yaml: editYaml,
        ...(editVersion.trim() ? { version: editVersion.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setOkMsg(`발행 완료 · ${r.rule_id}@${r.version}${r.previous_version ? ` (이전 ${r.previous_version} → archived)` : ''} · ${r.body_bytes}B`);
      // refresh
      await loadList();
      await loadDetail(detail.rule_id);
    } catch (e) {
      setErr(formatErr(e));
    } finally { setPublishing(false); }
  };

  if (!isAdmin) {
    return (
      <>
        <TopBar lang={LANG} email={email} onSignOut={signOut} />
        <SectionNav />
        <main style={{ padding: 18 }}>
          <div className="hd-card" style={{ padding: 18 }}>
            <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>접근 권한 없음</h2>
            <p className="hd-meta">위버 룰 편집기는 Admin / Super Admin 만 가능합니다.</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18, display: 'grid', gap: 14 }}>
        <div className="hd-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="hd-h2" style={{ margin: 0 }}>위버 룰 편집기</h2>
            <span className="hd-meta">
              R_10 룰의 active body_yaml을 보고 · 수정 · 발행. 발행 시 이전 active 는 archived, 60초 안에 모든 Edge Function이 신규 룰 사용.
            </span>
          </div>
        </div>

        {err && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-red)' }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}
        {okMsg && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-green)' }}>
            <span className="hd-meta" style={{ color: 'var(--hd-green)' }}>{okMsg}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14, alignItems: 'start' }}>
          {/* 좌: 룰 리스트 */}
          <div className="hd-card" style={{ padding: 12, position: 'sticky', top: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="hd-h3" style={{ margin: 0 }}>활성 룰</h3>
              <span style={{ flex: 1 }} />
              <button
                className="hd-btn"
                onClick={() => loadList()}
                disabled={listLoading}
                style={{ fontSize: 12 }}
              >
                {listLoading ? '…' : '새로고침'}
              </button>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {rules.map((r) => {
                const active = r.rule_id === selectedId;
                return (
                  <button
                    key={r.rule_id}
                    onClick={() => setSelectedId(r.rule_id)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: 'var(--hd-border)',
                      borderRadius: 'var(--hd-radius)',
                      background: active ? 'var(--hd-accent-soft, #eef3ff)' : 'transparent',
                      cursor: 'pointer',
                      borderColor: active ? 'var(--hd-accent)' : undefined,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.rule_id}</div>
                    <div className="hd-meta" style={{ fontSize: 11, marginTop: 2 }}>
                      <span className="hd-num">v{r.version}</span> · {Math.round(r.body_bytes / 1024)}KB
                    </div>
                    <div className="hd-meta" style={{ fontSize: 11, marginTop: 1 }}>
                      {r.last_actor ? `by ${r.last_actor.split('@')[0]}` : '—'}
                    </div>
                  </button>
                );
              })}
              {rules.length === 0 && !listLoading && (
                <div className="hd-meta" style={{ padding: 12, textAlign: 'center' }}>활성 룰 없음</div>
              )}
            </div>
          </div>

          {/* 우: 편집 폼 */}
          <div className="hd-card" style={{ padding: 16 }}>
            {!selectedId && (
              <div className="hd-meta">왼쪽에서 룰을 선택하세요.</div>
            )}
            {selectedId && detailLoading && (
              <div className="hd-meta">로딩…</div>
            )}
            {selectedId && !detailLoading && detail && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <h3 className="hd-h3" style={{ margin: 0 }}>{detail.rule_id}</h3>
                  <span className="hd-badge green">active v{detail.version}</span>
                  <span className="hd-meta">
                    마지막 발행 · {new Date(detail.last_modified).toLocaleString('ko-KR')}
                    {detail.last_actor ? ` · ${detail.last_actor}` : ''}
                  </span>
                </div>
                {detail.notes && (
                  <div className="hd-meta" style={{ marginBottom: 12, fontStyle: 'italic' }}>
                    notes: {detail.notes}
                  </div>
                )}

                {/* 빠른 안내 */}
                <details style={{ marginBottom: 12 }}>
                  <summary className="hd-meta" style={{ cursor: 'pointer' }}>
                    편집 가이드 (자연어→구조화 룰은 여기서)
                  </summary>
                  <div className="hd-meta" style={{ padding: 10, lineHeight: 1.6 }}>
                    <b>R_10.06_PromptTemplates</b> 의 <code>voice_studio_survey_build</code> 가 Studio의
                    "자연어 입력 → 검토 편집" 변환 룰입니다. 그 안의 <code>system</code> / <code>user</code> 텍스트를 수정하면 출력 spec 구조가 바뀝니다.
                    <br />
                    <b>발행 절차</b>: ① YAML 안의 <code>version</code> 필드를 bump (예: "2026-05-23.003" → ".004") ② "발행" 클릭.
                    이전 active는 자동으로 archived, 60초 안에 모든 Edge Function이 신규 룰을 사용합니다.
                  </div>
                </details>

                <label className="hd-eyebrow" style={{ display: 'block', marginBottom: 4 }}>
                  body_yaml ({(new TextEncoder().encode(editYaml).length / 1024).toFixed(1)}KB · {editYaml.split('\n').length} lines)
                </label>
                <textarea
                  value={editYaml}
                  onChange={(e) => setEditYaml(e.target.value)}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: 520,
                    padding: 12,
                    border: 'var(--hd-border)',
                    borderRadius: 'var(--hd-radius)',
                    fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
                    fontSize: 12,
                    lineHeight: 1.55,
                    whiteSpace: 'pre',
                    overflowWrap: 'normal',
                    overflowX: 'auto',
                    resize: 'vertical',
                  }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 10, marginTop: 12, alignItems: 'center' }}>
                  <label className="hd-eyebrow">버전 (override)</label>
                  <input
                    placeholder={yamlVersionInBody ? `(YAML 안의 ${yamlVersionInBody} 사용)` : '예: 2026-05-23.004'}
                    value={editVersion}
                    onChange={(e) => setEditVersion(e.target.value)}
                    style={{ height: 32, padding: '0 10px', border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                  />
                  <label className="hd-eyebrow">notes</label>
                  <input
                    placeholder="예: voice_studio_survey_build system 강화 — markdown fence 금지 명시"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{ height: 32, padding: '0 10px', border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', fontSize: 13 }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                  <span className={`hd-badge ${dirty ? 'amber' : 'ghost'}`}>{dirty ? '편집됨' : '변경 없음'}</span>
                  {effectiveVersion && (
                    <span className="hd-meta">
                      발행 버전 → <span className="hd-num">{effectiveVersion}</span>
                      {sameAsActive && <span style={{ color: 'var(--hd-red)', marginLeft: 6 }}>⚠ active와 동일 (bump 필요)</span>}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <button
                    className="hd-btn"
                    onClick={() => { if (detail) { setEditYaml(detail.body_yaml); setEditVersion(''); setNotes(''); } }}
                    disabled={!dirty || publishing}
                  >
                    되돌리기
                  </button>
                  <button
                    className="hd-btn primary"
                    onClick={submit}
                    disabled={!dirty || publishing || !effectiveVersion || sameAsActive}
                    title={!dirty ? '편집 후 활성화' : sameAsActive ? '버전 bump 필요' : ''}
                  >
                    {publishing ? '발행 중…' : '발행 (publish)'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

function extractYamlVersion(yaml: string): string {
  // 최상위 `version: <value>` 만 찾음 (들여쓰기 없는 라인). templates 안의 version: 은 무시.
  const m = yaml.match(/^version:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
  return (m?.[1] ?? '').trim();
}

function formatErr(e: unknown): string {
  if (e instanceof ApiClientError) {
    const b = e.body as { message?: string; error?: string; details?: Record<string, unknown> } | string;
    if (typeof b === 'object' && b) {
      const detail = b.details ? ` (${JSON.stringify(b.details)})` : '';
      return `${b.error ?? 'error'}: ${b.message ?? e.message}${detail}`;
    }
    return `HTTP ${e.status}: ${String(b).slice(0, 200)}`;
  }
  return e instanceof Error ? e.message : String(e);
}
