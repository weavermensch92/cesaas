'use client';
import type { CSSProperties } from 'react';
import type { StudioQuestion } from '@/lib/api';

interface Props {
  q: StudioQuestion;
  index: number;
  highlighted?: boolean;
  onPatch: (p: Partial<StudioQuestion>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}

const TYPE_OPTIONS: Array<StudioQuestion['type']> = [
  'single_select', 'multi_select', 'scale_1_5', 'scale_1_10',
  'nps', 'text_short', 'text_long', 'number', 'slider', 'consent',
];

export function QuestionRow({ q, index, highlighted, onPatch, onRemove, onUp, onDown }: Props) {
  const isAi = q.ai_generated === true && !q.edited_at;
  const isEdited = !!q.edited_at;

  function patch(p: Partial<StudioQuestion>) {
    onPatch({ ...p, edited_at: new Date().toISOString(), ai_generated: false });
  }

  return (
    <div style={rowStyle(highlighted)}>
      <span style={numStyle}>{index + 1}</span>

      {/* 배지: AI · 수정됨 · axis · required */}
      <div style={badgeColStyle}>
        {isAi && <span style={badgeAi}>AI ✦</span>}
        {isEdited && <span style={badgeEdited}>수정됨</span>}
        {q.axis && <span style={badgeAxis}>{q.axis}</span>}
        <span style={badgeType}>{q.type}</span>
      </div>

      {/* title 3-lang */}
      <div style={titleColStyle}>
        <LabelledInput label="ru" value={q.title_ru ?? ''}
          onChange={(v) => patch({ title_ru: v })} placeholder="русский 제목" />
        <LabelledInput label="ko" value={q.title_ko ?? ''}
          onChange={(v) => patch({ title_ko: v })} placeholder="한국어 제목" />
        <LabelledInput label="en" value={q.title_en ?? ''}
          onChange={(v) => patch({ title_en: v })} placeholder="English title" />
      </div>

      {/* type · axis · required */}
      <div style={controlsColStyle}>
        <select value={q.type} onChange={(e) => patch({ type: e.target.value as StudioQuestion['type'] })}
          style={selectStyle}>
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={q.axis ?? ''}
          onChange={(e) => patch({ axis: e.target.value || undefined })}
          placeholder="axis"
          style={{ ...selectStyle, width: 110 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={q.required ?? true}
            onChange={(e) => patch({ required: e.target.checked })} />
          required
        </label>
      </div>

      {/* reorder · remove */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="hd-btn ghost sm" onClick={onUp}>↑</button>
        <button className="hd-btn ghost sm" onClick={onDown}>↓</button>
        <button className="hd-btn ghost sm" onClick={onRemove} style={{ color: 'var(--hd-red)' }}>×</button>
      </div>

      {/* options preview */}
      {q.options && q.options.length > 0 && (
        <div style={optionsStyle}>
          <span className="hd-meta">options ({q.options.length}): </span>
          <span className="hd-meta" style={{ color: 'var(--hd-trust)' }}>
            {q.options.map((o) => o.label_ko ?? o.label_ru ?? o.value).filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}

function LabelledInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{
          flex: 1, height: 28, padding: '0 8px',
          border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
          font: 'inherit', fontSize: 13,
        }} />
    </div>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

function rowStyle(highlighted?: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '28px auto 1fr auto auto',
    gap: 10,
    alignItems: 'start',
    padding: 10,
    border: highlighted ? '2px solid var(--hd-trust)' : 'var(--hd-border)',
    borderRadius: 'var(--hd-radius)',
    background: '#fff',
  };
}

const numStyle: CSSProperties = {
  textAlign: 'center', color: 'var(--hd-trust)', fontWeight: 600, fontSize: 13,
  paddingTop: 4,
};
const badgeColStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 3,
};
const titleColStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
};
const controlsColStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start',
};
const optionsStyle: CSSProperties = {
  gridColumn: '2 / -1',
  paddingTop: 4,
  borderTop: '1px dashed var(--hd-steel-200)',
  marginTop: 2,
};

const labelStyle: CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--hd-steel-500)',
  textTransform: 'uppercase', width: 18,
};
const selectStyle: CSSProperties = {
  height: 26, padding: '0 6px',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', fontSize: 12, background: '#fff',
};

const badgeBase: CSSProperties = {
  display: 'inline-block', fontSize: 10, padding: '2px 5px',
  borderRadius: 3, fontWeight: 600, whiteSpace: 'nowrap',
};
const badgeAi: CSSProperties = {
  ...badgeBase,
  background: '#ede9fe', color: '#6d28d9',
};
const badgeEdited: CSSProperties = {
  ...badgeBase,
  background: 'var(--hd-accent-50)', color: 'var(--hd-prosperity)',
};
const badgeAxis: CSSProperties = {
  ...badgeBase,
  background: 'var(--hd-steel-100)', color: 'var(--hd-trust)',
};
const badgeType: CSSProperties = {
  ...badgeBase,
  background: 'transparent', color: 'var(--hd-steel-500)',
  border: '1px solid var(--hd-steel-200)',
};
