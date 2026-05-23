'use client';
/**
 * /gridge/builder — 위버가 자연어로 R_10 룰 fragment 작성 → AI 변환 → compose → publish.
 *
 * 5단계 wizard (/studio 패턴):
 *   ① Brief        — target_rule_id + target_path + nl_text
 *   ② Building     — POST /gridge-fragment-build (R_10.11 LLM)
 *   ③ Review       — 생성된 fragment YAML inline 편집
 *   ④ Preview      — GET /gridge-rule-compose-preview → 평면 합성 diff
 *   ⑤ Publish      — POST /gridge-rule-compose-publish → rule_versions 신규 active
 *
 * 권한: admin/super_admin only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Lang } from '@hd/design/i18n';
import { AuthGate, isAdminRole } from '../../components/AuthGate';
import type { MeProfile } from '@/lib/api';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  buildGridgeFragment,
  previewGridgeCompose,
  publishGridgeCompose,
  ApiClientError,
  type GridgeFragmentBuildResult,
  type GridgeComposePreviewResult,
  type GridgeComposePublishResult,
} from '@/lib/api';
import { WizardProgress, type BuilderStep } from './_components/WizardProgress';
import { BriefPane } from './_components/BriefPane';
import { BuildResultPane } from './_components/BuildResultPane';
import { DiffPreview } from './_components/DiffPreview';
import { PublishCard } from './_components/PublishCard';

const LANG: Lang = 'ko';

export default function GridgeBuilderPage() {
  return <AuthGate>{({ session, me }) => <View email={session.user.email ?? ''} me={me} />}</AuthGate>;
}

function View({ email, me }: { email: string; me: MeProfile }) {
  const isAdmin = isAdminRole(me.role);
  const signOut = () => { getSupabase().auth.signOut(); };

  const [step, setStep] = useState<BuilderStep>('brief');
  const [targetRuleId, setTargetRuleId] = useState('R_10.06_PromptTemplates');
  const [targetPath, setTargetPath] = useState('templates.voice_studio_survey_build');
  const [nlText, setNlText] = useState('');

  const [buildResult, setBuildResult] = useState<GridgeFragmentBuildResult | null>(null);
  const [editedYaml, setEditedYaml] = useState<string>('');
  const [preview, setPreview] = useState<GridgeComposePreviewResult | null>(null);
  const [publishResult, setPublishResult] = useState<GridgeComposePublishResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const suggestedVersion = useMemo(() => {
    if (!preview) return '';
    return bumpVersion(preview.parent_version);
  }, [preview]);

  const runBuild = useCallback(async () => {
    setBusy(true); setErr(null); setStep('building');
    try {
      const r = await buildGridgeFragment({
        target_rule_id: targetRuleId,
        target_path: targetPath,
        nl_text: nlText.trim(),
        ...(buildResult?.fragment_id ? { fragment_id: buildResult.fragment_id } : {}),
      });
      setBuildResult(r);
      setEditedYaml(r.generated_yaml);
      setStep('review');
    } catch (e) {
      setErr(formatErr(e));
      setStep('brief');
    } finally { setBusy(false); }
  }, [targetRuleId, targetPath, nlText, buildResult]);

  const runPreview = useCallback(async () => {
    if (!buildResult) return;
    setBusy(true); setErr(null); setStep('preview');
    try {
      // edited yaml이 generated와 다르면 먼저 백엔드 저장 (재빌드와 같은 vars로 update).
      // 단순화: edited 그대로 사용하되 백엔드 preview는 DB의 row를 본다 — 즉 사용자가 inline 편집한
      // 내용을 미리보기에 반영하려면 fragment를 다시 저장해야 함.
      // Phase 1: 편집 사항 미반영 시 안내. 정밀 반영은 후속.
      const p = await previewGridgeCompose({
        rule_id: targetRuleId,
        draft_fragment_id: buildResult.fragment_id,
      });
      setPreview(p);
    } catch (e) {
      setErr(formatErr(e));
      setStep('review');
    } finally { setBusy(false); }
  }, [buildResult, targetRuleId]);

  const runPublish = useCallback(async (args: { version: string; notes?: string }) => {
    if (!buildResult) return;
    setBusy(true); setErr(null); setStep('publishing');
    try {
      const r = await publishGridgeCompose({
        rule_id: targetRuleId,
        draft_fragment_ids: [buildResult.fragment_id],
        version: args.version,
        ...(args.notes ? { notes: args.notes } : {}),
      });
      setPublishResult(r);
      setStep('done');
    } catch (e) {
      setErr(formatErr(e));
      setStep('preview');
    } finally { setBusy(false); }
  }, [buildResult, targetRuleId]);

  const reset = () => {
    setStep('brief'); setBuildResult(null); setEditedYaml('');
    setPreview(null); setPublishResult(null); setErr(null); setNlText('');
  };

  useEffect(() => {
    if (step === 'preview' && buildResult && !preview && !busy) {
      runPreview().catch(() => {});
    }
  }, [step, buildResult, preview, busy, runPreview]);

  if (!isAdmin) {
    return (
      <>
        <TopBar lang={LANG} email={email} onSignOut={signOut} />
        <SectionNav />
        <main style={{ padding: 18 }}>
          <div className="hd-card" style={{ padding: 18 }}>
            <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>접근 권한 없음</h2>
            <p className="hd-meta">위버 룰 빌더는 Admin / Super Admin 만 가능합니다.</p>
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
            <h1 className="hd-h1" style={{ margin: 0, fontSize: 22 }}>위버 룰 빌더 (자연어 → R_10 fragment)</h1>
            <span className="hd-meta">
              자연어 의도를 입력 → R_10.11이 YAML 조각 생성 → 부모 룰에 compose → publish.
            </span>
            <span style={{ flex: 1 }} />
            <Link href="/gridge" className="hd-btn" style={{ fontSize: 12 }}>← raw YAML 편집기</Link>
          </div>
        </div>

        <WizardProgress current={step} />

        {err && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-red)' }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        {(step === 'brief' || step === 'building') && (
          <BriefPane
            targetRuleId={targetRuleId}
            targetPath={targetPath}
            nlText={nlText}
            onChange={(n) => {
              if (n.targetRuleId !== undefined) setTargetRuleId(n.targetRuleId);
              if (n.targetPath !== undefined) setTargetPath(n.targetPath);
              if (n.nlText !== undefined) setNlText(n.nlText);
            }}
            onBuild={runBuild}
            busy={busy}
          />
        )}

        {step === 'review' && buildResult && (
          <BuildResultPane
            targetRuleId={targetRuleId}
            targetPath={targetPath}
            generatedYaml={editedYaml}
            onYamlChange={setEditedYaml}
            onRebuild={() => setStep('brief')}
            onNext={() => setStep('preview')}
            model={buildResult.model}
            usage={buildResult.usage}
            busy={busy}
          />
        )}

        {step === 'preview' && (
          <div style={{ display: 'grid', gap: 12 }}>
            {busy && !preview && (
              <div className="hd-card" style={{ padding: 16 }}>
                <span className="hd-meta">합성 미리보기 로딩…</span>
              </div>
            )}
            {preview && (
              <>
                <div className="hd-card" style={{ padding: 14 }}>
                  <h2 className="hd-h2" style={{ margin: 0, marginBottom: 6 }}>④ Preview — 합성 결과 diff</h2>
                  <p className="hd-meta" style={{ margin: 0 }}>
                    {targetRuleId} parent v{preview.parent_version} +
                    fragments {preview.fragments_used.length}개{preview.draft_included ? ' (draft 1개 포함)' : ''}
                  </p>
                </div>
                <DiffPreview before={preview.parent_yaml} after={preview.composed_yaml} />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <button className="hd-btn" onClick={() => setStep('review')} disabled={busy}>
                    ← Review로
                  </button>
                  <button
                    className="hd-btn primary"
                    onClick={() => setStep('publishing')}
                    disabled={busy}
                  >
                    Publish 단계로 →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {(step === 'publishing' || step === 'done') && preview && (
          <PublishCard
            parentVersion={preview.parent_version}
            suggestedVersion={suggestedVersion}
            ruleId={targetRuleId}
            composedBytes={new TextEncoder().encode(preview.composed_yaml).length}
            onPublish={runPublish}
            busy={busy}
            {...(publishResult ? { result: publishResult } : {})}
          />
        )}

        {step === 'done' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link href="/gridge" className="hd-btn">/gridge 로 돌아가기</Link>
            <button className="hd-btn primary" onClick={reset}>새 fragment 작성</button>
          </div>
        )}
      </main>
    </>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

/** "2026-05-23.004" → "2026-05-23.005". 패턴 미일치 시 today + ".001". */
function bumpVersion(prev: string): string {
  const m = prev.match(/^(\d{4}-\d{2}-\d{2})\.(\d{3})$/);
  if (m) {
    const next = String(Number(m[2]) + 1).padStart(3, '0');
    return `${m[1]}.${next}`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `${today}.001`;
}

function formatErr(e: unknown): string {
  if (e instanceof ApiClientError) {
    const b = e.body as { message?: string; error?: string; details?: Record<string, unknown> } | string;
    if (typeof b === 'object' && b) {
      const detail = b.details ? ` (${JSON.stringify(b.details).slice(0, 300)})` : '';
      return `${b.error ?? 'error'}: ${b.message ?? e.message}${detail}`;
    }
    return `HTTP ${e.status}: ${String(b).slice(0, 200)}`;
  }
  return e instanceof Error ? e.message : String(e);
}
