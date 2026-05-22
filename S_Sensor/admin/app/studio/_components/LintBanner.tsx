'use client';
import type { CSSProperties } from 'react';
import type { StudioLintWarning, StudioSurveySpec } from '@/lib/api';

interface Props {
  warnings: StudioLintWarning[];
  onApplyPatch?: (patch: NonNullable<StudioLintWarning['suggestion_patch']>) => void;
}

export function LintBanner({ warnings, onApplyPatch }: Props) {
  if (warnings.length === 0) {
    return (
      <div style={{ ...wrapStyle, background: 'var(--hd-accent-50)', borderColor: 'var(--hd-accent-700)' }}>
        <span style={{ fontSize: 13, color: 'var(--hd-prosperity)' }}>✓ Lint 통과 — 경고 없음</span>
      </div>
    );
  }

  const errors = warnings.filter((w) => w.severity === 'error');
  const warns = warnings.filter((w) => w.severity === 'warn');

  return (
    <div style={{ ...wrapStyle, background: errors.length ? '#fef3f2' : '#fffaeb', borderColor: errors.length ? 'var(--hd-red)' : '#f59e0b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13, color: errors.length ? 'var(--hd-red)' : '#b45309' }}>
          ⚠ Lint {errors.length > 0 && `· error ${errors.length}`} {warns.length > 0 && `· warn ${warns.length}`}
        </strong>
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {warnings.map((w, i) => (
          <li key={i} style={lintItemStyle(w.severity)}>
            <span style={codeBadge(w.severity)}>{w.code}</span>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--hd-trust)' }}>{w.message_ko}</span>
            {w.suggestion_patch && onApplyPatch && (
              <button
                className="hd-btn ghost sm"
                onClick={() => onApplyPatch(w.suggestion_patch as NonNullable<StudioLintWarning['suggestion_patch']>)}
                style={{ fontSize: 11, color: 'var(--hd-discovery)' }}>
                자동 수정 제안
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  padding: 10,
  border: '1px solid',
  borderRadius: 'var(--hd-radius)',
  marginBottom: 10,
};

function lintItemStyle(sev: 'warn' | 'error'): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    background: '#fff',
    borderRadius: 4,
    border: `1px solid ${sev === 'error' ? '#fecaca' : '#fde68a'}`,
  };
}

function codeBadge(sev: 'warn' | 'error'): CSSProperties {
  return {
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 3,
    background: sev === 'error' ? 'var(--hd-red)' : '#f59e0b',
    color: '#fff',
    whiteSpace: 'nowrap',
  };
}

// re-export for callers' convenience
export type { StudioLintWarning, StudioSurveySpec };
