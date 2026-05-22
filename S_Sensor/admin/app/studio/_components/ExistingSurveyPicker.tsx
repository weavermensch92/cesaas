'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { studioSurveysList, type StudioSurveyListItem, type StudioTarget } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (surveyId: string) => void;
}

export function ExistingSurveyPicker({ open, onClose, onPick }: Props) {
  const [surveys, setSurveys] = useState<StudioSurveyListItem[]>([]);
  const [filter, setFilter] = useState<StudioTarget | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr(null);
    studioSurveysList({})
      .then((r) => setSurveys(r.surveys))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const filtered = filter === 'all' ? surveys : surveys.filter((s) => s.target_audience === filter);
  const byTarget = group(filtered, (s) => s.target_audience);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <strong style={{ fontSize: 16, color: 'var(--hd-trust)' }}>기존 설문 선택</strong>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'dealer', 'visitor'] as const).map((f) => (
              <button key={f}
                className={`hd-snav ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
                style={chipStyle(filter === f)}>{f}</button>
            ))}
          </div>
          <button className="hd-btn ghost sm" onClick={onClose} style={{ marginLeft: 6 }}>×</button>
        </div>

        <div style={bodyStyle}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--hd-steel-500)' }}>로딩…</div>}
          {err && (
            <div style={{ padding: 12, background: '#fef3f2', borderRadius: 4, marginBottom: 10 }}>
              <strong style={{ color: 'var(--hd-red)' }}>오류:</strong> {err}
            </div>
          )}
          {!loading && !err && filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--hd-steel-500)' }}>
              활성 설문이 없습니다.
            </div>
          )}

          {(['dealer', 'visitor'] as StudioTarget[]).map((t) => {
            const items = byTarget.get(t) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={t} style={{ marginBottom: 14 }}>
                <div style={groupLabelStyle}>{t}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map((s) => (
                    <button key={s.id} style={rowStyle} onClick={() => { onPick(s.id); onClose(); }}>
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, color: 'var(--hd-trust)' }}>{s.title}</div>
                        <div className="hd-meta" style={{ marginTop: 2 }}>
                          <code style={codeStyle}>{s.id}</code>
                          {' · '}{s.question_count}문항 · {s.language_default}
                          {s.estimated_minutes && ` · ~${s.estimated_minutes}분`}
                        </div>
                      </div>
                      {s.version_label && <span style={versionPill}>v{s.version_label}</span>}
                      <span style={statusPill(s.status)}>{s.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function group<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k) ?? [];
    arr.push(it);
    m.set(k, arr);
  }
  return m;
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100,
};
const modalStyle: CSSProperties = {
  width: '90vw', maxWidth: 720, maxHeight: '80vh',
  background: '#fff',
  borderRadius: 8,
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};
const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '12px 14px',
  borderBottom: '1px solid var(--hd-steel-100)',
};
const bodyStyle: CSSProperties = {
  flex: 1, overflowY: 'auto',
  padding: 14,
};
const groupLabelStyle: CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  color: 'var(--hd-steel-500)', marginBottom: 6, letterSpacing: 0.5,
};
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: 10,
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  background: '#fff', cursor: 'pointer',
  font: 'inherit',
};
const codeStyle: CSSProperties = {
  fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11,
  background: 'var(--hd-steel-50)', padding: '1px 5px', borderRadius: 3,
};
const versionPill: CSSProperties = {
  fontSize: 11, fontWeight: 600,
  padding: '2px 8px', borderRadius: 12,
  background: 'var(--hd-accent-50)', color: 'var(--hd-prosperity)',
};

function statusPill(status: string): CSSProperties {
  const fg = status === 'active' ? 'var(--hd-prosperity)' : status === 'archived' ? 'var(--hd-steel-500)' : 'var(--hd-discovery)';
  const bg = status === 'active' ? 'var(--hd-accent-50)' : status === 'archived' ? 'var(--hd-steel-100)' : '#dbeafe';
  return {
    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
    background: bg, color: fg,
  };
}

function chipStyle(active: boolean): CSSProperties {
  return {
    cursor: 'pointer', padding: '4px 10px', fontSize: 11,
    background: active ? 'var(--hd-trust)' : 'transparent',
    color: active ? '#fff' : 'var(--hd-trust)',
    borderRadius: 4,
  };
}
