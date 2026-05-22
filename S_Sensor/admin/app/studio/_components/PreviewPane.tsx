'use client';
import type { CSSProperties } from 'react';
import type { StudioDraftEntry, StudioTarget } from '@/lib/api';
import { PhoneMockup } from './PhoneMockup';

interface Props {
  drafts: Partial<Record<StudioTarget, StudioDraftEntry>>;
  activeTarget: StudioTarget;
  previewLang: 'ru' | 'ko' | 'en';
  onTargetChange: (t: StudioTarget) => void;
  onLangChange: (l: 'ru' | 'ko' | 'en') => void;
}

export function PreviewPane(p: Props) {
  const targets = (Object.keys(p.drafts) as StudioTarget[]).filter((k) => !!p.drafts[k]?.spec);
  const draft = p.drafts[p.activeTarget];

  return (
    <section className="hd-card" style={{ height: '100%' }}>
      <div className="hd-card-hd">
        <span className="hd-card-title">4. 미리보기</span>
        {targets.length > 1 && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            {targets.map((t) => (
              <button key={t}
                className={`hd-snav ${p.activeTarget === t ? 'active' : ''}`}
                onClick={() => p.onTargetChange(t)}
                style={tabStyle(p.activeTarget === t)}>{t}</button>
            ))}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['ru', 'ko', 'en'] as const).map((l) => (
            <button key={l}
              className={`hd-snav ${p.previewLang === l ? 'active' : ''}`}
              onClick={() => p.onLangChange(l)}
              style={langPillStyle(p.previewLang === l)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 14 }}>
        {draft?.spec ? (
          <PhoneMockup spec={draft.spec} target={p.activeTarget} language={p.previewLang} />
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--hd-steel-500)' }}>
            spec 없음
          </div>
        )}
      </div>
    </section>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    cursor: 'pointer', padding: '4px 10px', fontSize: 12,
    background: active ? 'var(--hd-trust)' : 'transparent',
    color: active ? '#fff' : 'var(--hd-trust)',
    borderRadius: 4,
  };
}

function langPillStyle(active: boolean): CSSProperties {
  return {
    cursor: 'pointer', padding: '3px 10px', fontSize: 11,
    fontWeight: 600,
    background: active ? 'var(--hd-accent-700)' : 'transparent',
    color: active ? '#fff' : 'var(--hd-trust)',
    borderRadius: 12,
    border: '1px solid var(--hd-steel-200)',
    textTransform: 'uppercase',
  };
}
