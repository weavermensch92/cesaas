'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  studioBuildSurvey,
  studioDeploy,
  studioLoadSurvey,
  type StudioDraftEntry,
  type StudioDeploymentResult,
  type StudioDeployError,
  type StudioLintWarning,
  type StudioSurveySpec,
  type StudioTarget,
  type StudioQuestion,
} from '@/lib/api';
import { lintSurveySpecClient, mergeWarnings } from '@/lib/studio_lint';
import { WizardProgress, type WizardStep } from './_components/WizardProgress';
import { BriefPane, type Mode } from './_components/BriefPane';
import { ReviewPane } from './_components/ReviewPane';
import { PreviewPane } from './_components/PreviewPane';
import { DeployCard } from './_components/DeployCard';
import { ExistingSurveyPicker } from './_components/ExistingSurveyPicker';

const LANG: Lang = 'ko';

interface ParentSurvey {
  id: string;
  title: string;
  version_label?: string;
}

export default function StudioPage() {
  return (
    <AuthGate>
      {({ session }) => <View email={session.user.email ?? ''} />}
    </AuthGate>
  );
}

function View({ email }: { email: string }) {
  const t = makeT(LANG);

  // ─── 상태 ──────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>('brief');
  const [mode, setMode] = useState<Mode>('fresh');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<'ko' | 'ru' | 'en'>('ko');
  const [targets, setTargets] = useState<StudioTarget[]>(['dealer']);
  const [archivePrev, setArchivePrev] = useState(true);
  const [editNotes, setEditNotes] = useState('');
  const [versionLabelInput, setVersionLabelInput] = useState('');

  const [building, setBuilding] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [briefGroupId, setBriefGroupId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<StudioTarget, StudioDraftEntry>>>({});
  const [activeTarget, setActiveTarget] = useState<StudioTarget>('dealer');
  const [previewLang, setPreviewLang] = useState<'ru' | 'ko' | 'en'>('ru');
  const [parentSurvey, setParentSurvey] = useState<ParentSurvey | null>(null);

  const [deployed, setDeployed] = useState<{
    deployments: StudioDeploymentResult[];
    errors?: StudioDeployError[];
  } | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const signOut = () => getSupabase().auth.signOut();

  // ─── lint (활성 target만 표시) ─────────────────────────────────────────────
  const warnings = useMemo<StudioLintWarning[]>(() => {
    const draft = drafts[activeTarget];
    if (!draft?.spec) return [];
    const serverWarnings = draft.warnings ?? [];
    const clientWarnings = lintSurveySpecClient(draft.spec, activeTarget);
    return mergeWarnings(serverWarnings, clientWarnings);
  }, [drafts, activeTarget]);

  // ─── actions ───────────────────────────────────────────────────────────────

  function toggleTarget(t: StudioTarget) {
    setTargets((cur) => {
      if (cur.includes(t)) {
        return cur.length > 1 ? cur.filter((x) => x !== t) : cur;
      }
      return [...cur, t];
    });
  }

  function resetToFresh() {
    setStep('brief');
    setMode('fresh');
    setDrafts({});
    setBriefGroupId(null);
    setParentSurvey(null);
    setEditNotes('');
    setDeployed(null);
    setErr(null);
    setVersionLabelInput('');
  }

  async function onBuild() {
    setBuilding(true);
    setErr(null);
    setDeployed(null);
    setStep('building');
    try {
      const isRegen = mode === 'regenerate' && parentSurvey;
      const baseSpec = isRegen ? drafts[activeTarget]?.spec : undefined;
      const r = await studioBuildSurvey({
        input_text: text,
        target_audiences: targets,
        language,
        ...(isRegen && baseSpec ? { base_spec: baseSpec, edit_notes: editNotes, parent_survey_id: parentSurvey!.id } : {}),
      });
      const next: Partial<Record<StudioTarget, StudioDraftEntry>> = {};
      for (const d of r.drafts) {
        next[d.target_audience] = d;
      }
      setBriefGroupId(r.brief_group_id);
      setDrafts(next);
      // activeTarget는 결과에 존재하는 첫 항목 또는 기존 유지
      if (!next[activeTarget]) {
        const first = r.drafts[0]?.target_audience;
        if (first) setActiveTarget(first);
      }
      setStep('review');
      // regenerate 완료 후 mode 종료
      if (mode === 'regenerate') {
        setMode('edit_existing');
        setEditNotes('');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStep('brief');
    } finally {
      setBuilding(false);
    }
  }

  function onSpecChange(target: StudioTarget, spec: StudioSurveySpec) {
    setDrafts((cur) => ({
      ...cur,
      [target]: { ...(cur[target] as StudioDraftEntry), spec },
    }));
  }

  function onApplyPatch(patch: NonNullable<StudioLintWarning['suggestion_patch']>) {
    const draft = drafts[activeTarget];
    if (!draft?.spec) return;
    const merged: StudioSurveySpec = {
      ...draft.spec,
      ...(patch as Partial<StudioSurveySpec>),
    };
    // questions patches는 question_ids 기준 머지 — 현재 spec에서는 spec-level만 적용
    onSpecChange(activeTarget, merged);
  }

  function onAddQuestion() {
    const draft = drafts[activeTarget];
    if (!draft?.spec) return;
    const newQ: StudioQuestion = {
      type: 'single_select',
      title_ru: '',
      title_ko: '',
      title_en: '',
      required: true,
      ai_generated: false,
      edited_at: new Date().toISOString(),
    };
    onSpecChange(activeTarget, { ...draft.spec, questions: [...draft.spec.questions, newQ] });
  }

  async function onPickExisting(surveyId: string) {
    setErr(null);
    try {
      const r = await studioLoadSurvey(surveyId);
      setMode('edit_existing');
      setTargets([r.target_audience]);
      setActiveTarget(r.target_audience);
      setBriefGroupId(r.brief_group_id);
      setParentSurvey({
        id: r.parent_survey.id,
        title: r.parent_survey.title,
        ...(r.parent_survey.version_label ? { version_label: r.parent_survey.version_label } : {}),
      });
      setDrafts({
        [r.target_audience]: {
          target_audience: r.target_audience,
          draft_id: r.draft_id,
          spec: r.spec,
          warnings: [],
        },
      });
      setStep('review');
      setDeployed(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeploy(targetsOverride?: StudioTarget[]) {
    const deployTargets = (targetsOverride ?? targets).filter((t) => drafts[t]?.spec);
    if (deployTargets.length === 0) return;
    setDeploying(true);
    setErr(null);
    setStep('deploying');
    try {
      const deployments = deployTargets.map((t) => {
        const d = drafts[t]!;
        return {
          target_audience: t,
          spec: d.spec!,
          ...(d.draft_id ? { draft_id: d.draft_id } : {}),
          ...(versionLabelInput ? { version_label: versionLabelInput } : {}),
        };
      });
      const r = await studioDeploy({
        deployments,
        ...(briefGroupId ? { brief_group_id: briefGroupId } : {}),
        archive_previous: archivePrev,
      });
      setDeployed({ deployments: r.deployments, ...(r.errors ? { errors: r.errors } : {}) });
      setStep('deployed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStep('review');
    } finally {
      setDeploying(false);
    }
  }

  function onCopyJson() {
    const draft = drafts[activeTarget];
    if (!draft?.spec) return;
    void navigator.clipboard.writeText(JSON.stringify(draft.spec, null, 2));
  }

  const activeSpec = drafts[activeTarget]?.spec;

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h1 className="hd-h1" style={{ margin: 0 }}>Studio · V_60</h1>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className={`hd-btn ${mode === 'fresh' ? 'primary' : 'ghost'} sm`}
              onClick={resetToFresh}>새 질문지 생성</button>
            <button className="hd-btn ghost sm" onClick={() => setPickerOpen(true)}>
              기존 질문지 수정
            </button>
          </div>
        </div>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>
          자연어 → LLM 빌드 → 검토·편집 → 미리보기 → 배포. R_10.06 + R_10.08 · gridge_admin 전용.
          {mode !== 'fresh' && parentSurvey && (
            <span> · <strong>편집 모드</strong>: {parentSurvey.title} {parentSurvey.version_label && `v${parentSurvey.version_label}`}</span>
          )}
        </p>

        <WizardProgress current={step} />

        {err && (
          <div className="hd-card" style={{ padding: 10, marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        {/* 3-pane grid */}
        <div style={gridStyle}>
          <BriefPane
            mode={mode}
            text={text}
            language={language}
            targets={targets}
            archivePrev={archivePrev}
            building={building}
            editNotes={editNotes}
            {...(parentSurvey ? { parentSummary: parentSurvey } : {})}
            onText={setText}
            onLanguage={setLanguage}
            onToggleTarget={toggleTarget}
            onArchivePrev={setArchivePrev}
            onEditNotes={setEditNotes}
            onBuild={onBuild}
            onSwitchToFresh={resetToFresh}
            onSwitchToRegenerate={() => { setMode('regenerate'); }}
          />

          <ReviewPane
            drafts={drafts}
            activeTarget={activeTarget}
            warnings={warnings}
            building={building}
            onSwitchTarget={setActiveTarget}
            onSpecChange={onSpecChange}
            onApplyPatch={onApplyPatch}
            onAddQuestion={onAddQuestion}
          />

          <div>
            <PreviewPane
              drafts={drafts}
              activeTarget={activeTarget}
              previewLang={previewLang}
              onTargetChange={setActiveTarget}
              onLangChange={setPreviewLang}
            />

            {activeSpec && (
              <DeployCard
                targets={targets.filter((t) => drafts[t]?.spec)}
                spec={activeSpec}
                archivePrev={archivePrev}
                deploying={deploying}
                {...(deployed ? { deployed } : {})}
                versionLabelInput={versionLabelInput}
                onVersionLabel={setVersionLabelInput}
                onArchivePrev={setArchivePrev}
                onDeploy={() => onDeploy()}
                onRetryTarget={(t) => onDeploy([t])}
                onCopyJson={onCopyJson}
              />
            )}
          </div>
        </div>

        <ExistingSurveyPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={onPickExisting}
        />
      </main>
    </>
  );
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(360px, 420px) minmax(0, 1fr) minmax(360px, 420px)',
  gap: 12,
  alignItems: 'flex-start',
};
