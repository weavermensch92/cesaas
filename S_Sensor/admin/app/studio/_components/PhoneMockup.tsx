'use client';
import { useState, type CSSProperties } from 'react';
import type { StudioQuestion, StudioSurveySpec, StudioTarget } from '@/lib/api';

interface Props {
  spec: StudioSurveySpec;
  target: StudioTarget;
  language: 'ru' | 'ko' | 'en';
}

/**
 * 와이어프레임 voice-studio.jsx:441-522 폰 mockup 포팅.
 * 응답자가 보는 화면을 ru/ko/en 토글 + Visitor/Dealer 헤더로 재현.
 */
export function PhoneMockup({ spec, target, language }: Props) {
  const [idx, setIdx] = useState(0);
  const qs = spec.questions;
  if (qs.length === 0) {
    return (
      <div style={frameStyle}>
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--hd-steel-500)' }}>
          문항 없음
        </div>
      </div>
    );
  }
  const safe = Math.min(idx, qs.length - 1);
  const q = qs[safe]!;
  const progress = ((safe + 1) / qs.length) * 100;

  return (
    <div style={frameStyle}>
      {/* status bar */}
      <div style={statusBarStyle}>
        <span>{target === 'dealer' ? '딜러 단말' : 'Visitor PWA'}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--hd-steel-500)' }}>HD건설기계</span>
      </div>

      {/* progress */}
      <div style={progressBarBg}>
        <div style={{ ...progressBarFg, width: `${progress}%` }} />
      </div>
      <div style={progressLabelStyle}>Q{safe + 1} / {qs.length}</div>

      {/* question */}
      <div style={questionBodyStyle}>
        <div style={questionTitleStyle}>
          {pickTitle(q, language)}
          {q.required && <span style={{ color: 'var(--hd-red)', marginLeft: 4 }}>*</span>}
        </div>
        <div style={{ marginTop: 14 }}>
          <QuestionPreview q={q} language={language} />
        </div>
      </div>

      {/* nav */}
      <div style={navStyle}>
        <button className="hd-btn ghost sm" onClick={() => setIdx(Math.max(0, safe - 1))}
          disabled={safe === 0}>이전</button>
        <span style={{ flex: 1 }} />
        <button className="hd-btn primary sm" onClick={() => setIdx(Math.min(qs.length - 1, safe + 1))}
          disabled={safe === qs.length - 1}>다음</button>
      </div>
    </div>
  );
}

function QuestionPreview({ q, language }: { q: StudioQuestion; language: 'ru' | 'ko' | 'en' }) {
  if (q.type === 'single_select' || q.type === 'multi_select') {
    const opts = Array.isArray(q.options) ? q.options : [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {opts.length === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--hd-steel-500)' }}>(옵션 없음)</span>
        ) : opts.map((o, i) => (
          <div key={i} style={optionItemStyle}>
            <span style={{
              width: 16, height: 16,
              borderRadius: q.type === 'single_select' ? '50%' : 3,
              border: '1.5px solid var(--hd-steel-300)',
            }} />
            <span style={{ fontSize: 12 }}>
              {pickLabel(o, language)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (q.type === 'nps') {
    return (
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {Array.from({ length: 11 }, (_, n) => (
          <span key={n} style={npsBtnStyle}>{n}</span>
        ))}
      </div>
    );
  }
  if (q.type === 'scale_1_5' || q.type === 'scale_1_10') {
    const max = q.type === 'scale_1_10' ? 10 : 5;
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: max }, (_, n) => (
          <span key={n} style={npsBtnStyle}>{n + 1}</span>
        ))}
      </div>
    );
  }
  if (q.type === 'text_short' || q.type === 'text_long') {
    return (
      <div style={{
        minHeight: q.type === 'text_long' ? 80 : 32,
        border: 'var(--hd-border)',
        borderRadius: 6,
        padding: 8,
        background: 'var(--hd-steel-50)',
        fontSize: 11,
        color: 'var(--hd-steel-500)',
      }}>(입력)</div>
    );
  }
  if (q.type === 'consent') {
    return (
      <div style={optionItemStyle}>
        <span style={{ width: 16, height: 16, borderRadius: 3, border: '1.5px solid var(--hd-steel-300)' }} />
        <span style={{ fontSize: 12 }}>동의합니다</span>
      </div>
    );
  }
  return <span style={{ fontSize: 11, color: 'var(--hd-steel-500)' }}>({q.type} 미리보기 미구현)</span>;
}

function pickTitle(q: StudioQuestion, lang: 'ru' | 'ko' | 'en'): string {
  const field = lang === 'ko' ? q.title_ko : lang === 'en' ? q.title_en : q.title_ru;
  return field || q.title_ru || q.title_ko || q.title_en || '(제목 없음)';
}

function pickLabel(o: { label_ru?: string; label_ko?: string; label_en?: string; value?: string }, lang: 'ru' | 'ko' | 'en'): string {
  const field = lang === 'ko' ? o.label_ko : lang === 'en' ? o.label_en : o.label_ru;
  return field || o.label_ru || o.label_ko || o.label_en || o.value || '';
}

// ─── styles ─────────────────────────────────────────────────────────────────

const frameStyle: CSSProperties = {
  width: 260, height: 460,
  border: '8px solid var(--hd-steel-900)',
  borderRadius: 28,
  background: '#fff',
  margin: '0 auto',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};
const statusBarStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px',
  background: 'var(--hd-trust)', color: '#fff',
  fontSize: 11,
};
const progressBarBg: CSSProperties = {
  height: 3, background: 'var(--hd-steel-100)',
};
const progressBarFg: CSSProperties = {
  height: '100%', background: 'var(--hd-accent-700)',
  transition: 'width .2s',
};
const progressLabelStyle: CSSProperties = {
  fontSize: 10, color: 'var(--hd-steel-500)',
  padding: '4px 10px',
};
const questionBodyStyle: CSSProperties = {
  flex: 1, padding: '0 14px 10px', overflowY: 'auto',
};
const questionTitleStyle: CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--hd-trust)',
  lineHeight: 1.4,
};
const navStyle: CSSProperties = {
  display: 'flex', gap: 6,
  padding: '8px 10px',
  borderTop: '1px solid var(--hd-steel-100)',
};
const optionItemStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 8px',
  background: 'var(--hd-steel-50)',
  borderRadius: 6,
};
const npsBtnStyle: CSSProperties = {
  width: 20, height: 20,
  border: '1px solid var(--hd-steel-300)',
  borderRadius: 4,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 10, color: 'var(--hd-trust)',
};
