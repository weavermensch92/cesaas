'use client';
import type { CSSProperties } from 'react';

export type WizardStep = 'brief' | 'building' | 'review' | 'preview' | 'deploying' | 'deployed';

const STEPS: { key: WizardStep; label: string; index: number }[] = [
  { key: 'brief',     label: 'Brief',   index: 1 },
  { key: 'building',  label: 'Build',   index: 2 },
  { key: 'review',    label: 'Review',  index: 3 },
  { key: 'preview',   label: 'Preview', index: 4 },
  { key: 'deploying', label: 'Deploy',  index: 5 },
];

interface Props {
  current: WizardStep;
}

export function WizardProgress({ current }: Props) {
  const currentIdx = stepIndex(current);
  return (
    <div style={wrapStyle}>
      {STEPS.map((s, i) => {
        const status = stateOf(s.key, current, currentIdx);
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={badgeStyle(status)}>{s.index}</span>
            <span style={labelStyle(status)}>{s.label}</span>
            {i < STEPS.length - 1 && <span style={connectorStyle(currentIdx > s.index)} />}
          </div>
        );
      })}
    </div>
  );
}

type StepState = 'done' | 'current' | 'pending';

function stepIndex(step: WizardStep): number {
  const found = STEPS.find((s) => s.key === step);
  if (found) return found.index;
  if (step === 'deployed') return 6;
  return 1;
}

function stateOf(stepKey: WizardStep, current: WizardStep, currentIdx: number): StepState {
  const idx = STEPS.find((s) => s.key === stepKey)?.index ?? 0;
  if (current === 'deployed') return 'done';
  if (idx === currentIdx) return 'current';
  if (idx < currentIdx) return 'done';
  return 'pending';
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  background: '#fff',
  border: 'var(--hd-border)',
  borderRadius: 'var(--hd-radius)',
  marginBottom: 14,
  flexWrap: 'wrap',
};

function badgeStyle(state: StepState): CSSProperties {
  const palette = state === 'done'
    ? { bg: 'var(--hd-accent-700)', fg: '#fff' }
    : state === 'current'
      ? { bg: 'var(--hd-trust)', fg: '#fff' }
      : { bg: 'var(--hd-steel-100)', fg: 'var(--hd-steel-500)' };
  return {
    width: 24, height: 24, borderRadius: '50%',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: palette.bg, color: palette.fg,
    fontSize: 12, fontWeight: 600,
  };
}

function labelStyle(state: StepState): CSSProperties {
  return {
    fontSize: 13,
    fontWeight: state === 'current' ? 600 : 500,
    color: state === 'pending' ? 'var(--hd-steel-500)' : 'var(--hd-trust)',
  };
}

function connectorStyle(active: boolean): CSSProperties {
  return {
    width: 24,
    height: 2,
    background: active ? 'var(--hd-accent-700)' : 'var(--hd-steel-200)',
    marginLeft: 4,
  };
}
