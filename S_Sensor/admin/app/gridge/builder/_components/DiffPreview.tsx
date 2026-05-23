'use client';
import { useMemo } from 'react';

interface Props {
  before: string;
  after: string;
}

/** 단순 라인 diff (LCS X — char-by-line set 비교). 정확한 diff가 필요하면 `diff` lib 도입 검토. */
export function DiffPreview({ before, after }: Props) {
  const { leftRows, rightRows } = useMemo(() => buildSideBySide(before, after), [before, after]);

  return (
    <div className="hd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: 'var(--hd-border)' }}>
        <div style={headerStyle('left')}>현재 active (parent + 기존 fragments)</div>
        <div style={headerStyle('right')}>발행 후 (drafts inject)</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', maxHeight: 520, overflow: 'auto' }}>
        <pre style={paneStyle}>
          {leftRows.map((r, i) => (
            <div key={`l-${i}`} style={rowStyle(r.tag, 'left')}>
              <span style={lineNoStyle}>{r.lineNo > 0 ? r.lineNo : ' '}</span>
              <span style={{ whiteSpace: 'pre' }}>{r.text}</span>
            </div>
          ))}
        </pre>
        <pre style={paneStyle}>
          {rightRows.map((r, i) => (
            <div key={`r-${i}`} style={rowStyle(r.tag, 'right')}>
              <span style={lineNoStyle}>{r.lineNo > 0 ? r.lineNo : ' '}</span>
              <span style={{ whiteSpace: 'pre' }}>{r.text}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

type Tag = 'same' | 'add' | 'del' | 'pad';
interface Row { tag: Tag; text: string; lineNo: number; }

/** 좌(before) / 우(after) 줄 단위로 같은 줄은 같은 라인에, 다른 줄은 좌/우에 add/del 컬러로. */
function buildSideBySide(before: string, after: string): { leftRows: Row[]; rightRows: Row[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  const aSet = new Set(a);
  const bSet = new Set(b);
  const leftRows: Row[] = [];
  const rightRows: Row[] = [];

  // 순차 진행 — 두 쪽이 같은 위치에 같은 텍스트면 same, 아니면 add/del로 분리 표시
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const la = a[i];
    const lb = b[i];
    if (la !== undefined && lb !== undefined && la === lb) {
      leftRows.push({ tag: 'same', text: la, lineNo: i + 1 });
      rightRows.push({ tag: 'same', text: lb, lineNo: i + 1 });
    } else {
      if (la !== undefined) {
        leftRows.push({ tag: bSet.has(la) ? 'same' : 'del', text: la, lineNo: i + 1 });
      } else {
        leftRows.push({ tag: 'pad', text: '', lineNo: 0 });
      }
      if (lb !== undefined) {
        rightRows.push({ tag: aSet.has(lb) ? 'same' : 'add', text: lb, lineNo: i + 1 });
      } else {
        rightRows.push({ tag: 'pad', text: '', lineNo: 0 });
      }
    }
  }
  return { leftRows, rightRows };
}

function headerStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--hd-trust)',
    background: 'var(--hd-steel-50, #f5f7fb)',
    borderRight: side === 'left' ? 'var(--hd-border)' : undefined,
  };
}
const paneStyle: React.CSSProperties = {
  margin: 0, padding: 0,
  fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
  fontSize: 11, lineHeight: 1.5,
  background: '#fff',
};
function rowStyle(tag: Tag, side: 'left' | 'right'): React.CSSProperties {
  const bg = tag === 'add' ? '#e6ffed'
    : tag === 'del' ? '#ffeef0'
    : tag === 'pad' ? '#f8f8f8'
    : 'transparent';
  return {
    display: 'grid', gridTemplateColumns: '38px 1fr',
    padding: '0 6px', background: bg,
    borderRight: side === 'left' ? 'var(--hd-border)' : undefined,
  };
}
const lineNoStyle: React.CSSProperties = {
  color: 'var(--hd-steel-400, #98a2b3)',
  textAlign: 'right',
  paddingRight: 8,
  userSelect: 'none',
};
