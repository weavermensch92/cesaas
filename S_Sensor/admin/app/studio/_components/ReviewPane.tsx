'use client';
import type { CSSProperties } from 'react';
import type { StudioDraftEntry, StudioQuestion, StudioSurveySpec, StudioTarget, StudioLintWarning } from '@/lib/api';
import { LintBanner } from './LintBanner';
import { QuestionRow } from './QuestionRow';

interface Props {
  drafts: Partial<Record<StudioTarget, StudioDraftEntry>>;
  activeTarget: StudioTarget;
  warnings: StudioLintWarning[];
  building: boolean;
  onSwitchTarget: (t: StudioTarget) => void;
  onSpecChange: (target: StudioTarget, spec: StudioSurveySpec) => void;
  onApplyPatch: (patch: NonNullable<StudioLintWarning['suggestion_patch']>) => void;
  onAddQuestion: () => void;
}

export function ReviewPane(p: Props) {
  const targets = (Object.keys(p.drafts) as StudioTarget[]).filter((k) => p.drafts[k]);
  const draft = p.drafts[p.activeTarget];

  return (
    <section className="hd-card" style={wrapStyle}>
      <div className="hd-card-hd" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="hd-card-title">2. 검토·편집</span>
        {targets.length > 1 && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            {targets.map((t) => (
              <button key={t}
                className={`hd-snav ${p.activeTarget === t ? 'active' : ''}`}
                onClick={() => p.onSwitchTarget(t)}
                style={tabStyle(p.activeTarget === t)}>
                {t}{p.drafts[t]?.error ? ' ⚠' : ''}
              </button>
            ))}
          </div>
        )}
        {draft && draft.spec && (
          <span className="hd-card-sub" style={{ marginLeft: 'auto' }}>
            {draft.spec.questions.length}문항
            {draft.model && ` · ${draft.model}`}
            {draft.usage && ` · tokens ${draft.usage.input_tokens}/${draft.usage.output_tokens}`}
          </span>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {p.building && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--hd-steel-500)' }}>
            ⏳ LLM 빌드 중…
          </div>
        )}

        {!p.building && !draft && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--hd-steel-500)' }}>
            좌측에서 brief를 입력하고 "LLM 빌드"를 누르세요.
          </div>
        )}

        {!p.building && draft?.error && (
          <div style={{ padding: 12, background: '#fef3f2', borderRadius: 4 }}>
            <strong style={{ color: 'var(--hd-red)' }}>빌드 실패 ({draft.error.code})</strong>
            <div className="hd-meta">{draft.error.message}</div>
          </div>
        )}

        {draft?.spec && (
          <>
            <LintBanner warnings={p.warnings} onApplyPatch={p.onApplyPatch} />

            <div style={{ marginBottom: 10 }}>
              <input
                value={draft.spec.title}
                onChange={(e) => p.onSpecChange(p.activeTarget, { ...draft.spec!, title: e.target.value })}
                placeholder="설문 제목"
                style={titleStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="hd-eyebrow">language_default</span>
              <select
                value={draft.spec.language_default ?? 'ru'}
                onChange={(e) => p.onSpecChange(p.activeTarget, { ...draft.spec!, language_default: e.target.value as 'ru' | 'en' | 'ko' })}
                style={selectStyle}>
                <option value="ru">ru</option>
                <option value="ko">ko</option>
                <option value="en">en</option>
              </select>
              <span className="hd-eyebrow">est. minutes</span>
              <input type="number" min={1} max={60}
                value={draft.spec.estimated_minutes ?? ''}
                onChange={(e) => p.onSpecChange(p.activeTarget, {
                  ...draft.spec!,
                  estimated_minutes: e.target.value === '' ? undefined : Number(e.target.value),
                })}
                style={{ ...selectStyle, width: 60 }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draft.spec.questions.map((q, i) => (
                <QuestionRow key={q.id ?? i} q={q} index={i}
                  onPatch={(patch) => updateQuestion(p, p.activeTarget, draft.spec!, i, patch)}
                  onRemove={() => removeQuestion(p, p.activeTarget, draft.spec!, i)}
                  onUp={() => moveQuestion(p, p.activeTarget, draft.spec!, i, -1)}
                  onDown={() => moveQuestion(p, p.activeTarget, draft.spec!, i, 1)}
                />
              ))}
            </div>

            <button className="hd-btn ghost sm" onClick={p.onAddQuestion}
              style={{ marginTop: 10, fontSize: 12 }}>
              + 문항 추가
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function updateQuestion(p: Props, target: StudioTarget, spec: StudioSurveySpec, i: number, patch: Partial<StudioQuestion>) {
  const questions = spec.questions.map((q, idx) => idx === i ? { ...q, ...patch } : q);
  p.onSpecChange(target, { ...spec, questions });
}

function removeQuestion(p: Props, target: StudioTarget, spec: StudioSurveySpec, i: number) {
  const questions = spec.questions.filter((_, idx) => idx !== i);
  p.onSpecChange(target, { ...spec, questions });
}

function moveQuestion(p: Props, target: StudioTarget, spec: StudioSurveySpec, i: number, dir: -1 | 1) {
  const arr = [...spec.questions];
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  p.onSpecChange(target, { ...spec, questions: arr });
}

const wrapStyle: CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column' };
const titleStyle: CSSProperties = {
  width: '100%', padding: 10,
  font: '600 16px var(--hd-font-display)',
  color: 'var(--hd-trust)',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
};
const selectStyle: CSSProperties = {
  height: 28, padding: '0 8px',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', fontSize: 12, background: '#fff',
};
function tabStyle(active: boolean): CSSProperties {
  return {
    cursor: 'pointer', padding: '4px 10px', fontSize: 12,
    background: active ? 'var(--hd-trust)' : 'transparent',
    color: active ? '#fff' : 'var(--hd-trust)',
    borderRadius: 4,
  };
}
