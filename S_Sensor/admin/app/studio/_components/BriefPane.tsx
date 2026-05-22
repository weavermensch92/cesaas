'use client';
import type { CSSProperties } from 'react';
import type { StudioTarget } from '@/lib/api';

const EXAMPLES = [
  '러시아 광업(mining) 대형 사업자 대상 31문항 dealer 설문. 6 axis + 마케팅 7질문 + NPS + 동의. 광업 특유의 가동시간·디젤 가격·환경 규제 질문 추가.',
  '농업 보조 장비 visitor PWA 18문항. 핵심 axis 4 + 마케팅 5 + NPS + 동의 필수. 연락처는 옵트인. 농업 사업자에게 친숙한 어휘로.',
  '렌탈 사업자(rental) 인터뷰 dealer 25문항. 가동률·정비 비용·대체기 보유에 집중.',
];

export type Mode = 'fresh' | 'edit_existing' | 'regenerate';

interface Props {
  mode: Mode;
  text: string;
  language: 'ko' | 'ru' | 'en';
  targets: StudioTarget[];
  archivePrev: boolean;
  building: boolean;
  editNotes: string;
  parentSummary?: { id: string; title: string; version_label?: string };
  onText: (s: string) => void;
  onLanguage: (l: 'ko' | 'ru' | 'en') => void;
  onToggleTarget: (t: StudioTarget) => void;
  onArchivePrev: (v: boolean) => void;
  onEditNotes: (s: string) => void;
  onBuild: () => void;
  onSwitchToFresh: () => void;
  onSwitchToRegenerate: () => void;
}

export function BriefPane(p: Props) {
  const isEdit = p.mode === 'edit_existing';
  const isRegen = p.mode === 'regenerate';

  return (
    <section className="hd-card" style={wrapStyle}>
      <div className="hd-card-hd">
        <span className="hd-card-title">
          {isRegen ? '1. 재생성 지시' : isEdit ? '1. 원본 설문 정보' : '1. 자연어 입력'}
        </span>
        {p.parentSummary && (
          <span className="hd-card-sub">
            {p.parentSummary.title} {p.parentSummary.version_label && `· v${p.parentSummary.version_label}`}
          </span>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {/* 모드 전환 */}
        {(isEdit || isRegen) && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button className="hd-btn ghost sm" onClick={p.onSwitchToFresh}>← 신규로 전환</button>
            {isEdit && (
              <button className="hd-btn ghost sm" onClick={p.onSwitchToRegenerate}>
                재생성 with notes
              </button>
            )}
          </div>
        )}

        {/* Targets · Language · Archive */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hd-eyebrow">Target</span>
          <TargetChip label="Dealer" active={p.targets.includes('dealer')} disabled={isEdit || isRegen}
            onClick={() => p.onToggleTarget('dealer')} />
          <TargetChip label="Visitor" active={p.targets.includes('visitor')} disabled={isEdit || isRegen}
            onClick={() => p.onToggleTarget('visitor')} />

          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />

          <span className="hd-eyebrow">Lang</span>
          <select value={p.language} onChange={(e) => p.onLanguage(e.target.value as 'ko' | 'ru' | 'en')}
            style={selectStyle}>
            <option value="ko">ko</option>
            <option value="ru">ru</option>
            <option value="en">en</option>
          </select>

          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={p.archivePrev}
              onChange={(e) => p.onArchivePrev(e.target.checked)} />
            이전 active archive
          </label>
        </div>

        {/* edit_notes (regenerate) OR input_text (fresh) */}
        {isRegen ? (
          <>
            <textarea
              value={p.editNotes}
              onChange={(e) => p.onEditNotes(e.target.value)}
              placeholder="예: 광산 산업 변수 추가. 디젤 가격·환경 규제 질문 강화. NPS와 consent 유지."
              style={textareaStyle}
            />
            <div style={{ marginTop: 8 }}>
              <span className="hd-meta">{p.editNotes.length}/2000자</span>
            </div>
          </>
        ) : isEdit ? (
          <p className="hd-meta" style={{ margin: 0 }}>
            기존 설문을 편집기로 로드했습니다. 우측 패널에서 직접 수정하거나 "재생성 with notes" 로 LLM에게 보강을 맡길 수 있습니다.
          </p>
        ) : (
          <>
            <textarea
              value={p.text}
              onChange={(e) => p.onText(e.target.value)}
              placeholder="예: 러시아 광업 대형 사업자 대상 31문항 dealer 설문..."
              style={textareaStyle}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="hd-eyebrow" style={{ alignSelf: 'center', marginRight: 4 }}>예시</span>
              {EXAMPLES.map((ex, i) => (
                <button key={i} className="hd-btn sm ghost" onClick={() => p.onText(ex)}
                  style={{ fontSize: 11, color: 'var(--hd-discovery)' }}>
                  {ex.slice(0, 30)}…
                </button>
              ))}
            </div>
          </>
        )}

        {/* Build / Regenerate button */}
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="hd-btn primary"
            onClick={p.onBuild}
            disabled={p.building || (!isEdit && !isRegen && p.text.length < 8)
                                || (isRegen && p.editNotes.length < 4)
                                || p.targets.length === 0}>
            {p.building
              ? `${isRegen ? '재생성' : '빌드'} 중… (10~25s)`
              : isRegen
                ? `재생성 (${p.targets.length} target)`
                : isEdit
                  ? '편집 모드 — 우측에서 직접 수정'
                  : `LLM 빌드 (${p.targets.length || '0'} target)`}
          </button>
          {!isEdit && !isRegen && (
            <span className="hd-meta">{p.text.length}/4000자</span>
          )}
        </div>
      </div>
    </section>
  );
}

function TargetChip({ label, active, disabled, onClick }: {
  label: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <span
      className={`hd-snav ${active ? 'active' : ''}`}
      onClick={disabled ? undefined : onClick}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '4px 10px',
        fontSize: 12,
        opacity: disabled ? 0.6 : 1,
      }}>
      {active ? '✓ ' : ''}{label}
    </span>
  );
}

const wrapStyle: CSSProperties = { marginBottom: 0, height: '100%' };
const selectStyle: CSSProperties = {
  height: 28, padding: '0 8px', border: 'var(--hd-border)',
  borderRadius: 'var(--hd-radius)', font: 'inherit', fontSize: 12, background: '#fff',
};
const textareaStyle: CSSProperties = {
  width: '100%', minHeight: 140, padding: 12,
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', fontSize: 14, resize: 'vertical',
};
