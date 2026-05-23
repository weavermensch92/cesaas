'use client';
import { useState, useEffect } from 'react';
import type { GridgeComposePublishResult } from '@/lib/api';

interface Props {
  parentVersion: string;
  suggestedVersion: string;       // 자동 bump 제안 (예: parentVersion + ".N+1")
  ruleId: string;
  composedBytes: number;
  onPublish: (args: { version: string; notes?: string }) => Promise<void>;
  busy: boolean;
  result?: GridgeComposePublishResult;
}

export function PublishCard(props: Props) {
  const [version, setVersion] = useState(props.suggestedVersion);
  const [notes, setNotes] = useState('');

  useEffect(() => { setVersion(props.suggestedVersion); }, [props.suggestedVersion]);

  const sameAsParent = version.trim() === props.parentVersion;
  const canPublish = !props.busy && version.trim() && !sameAsParent;

  return (
    <div className="hd-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 className="hd-h2" style={{ margin: 0 }}>⑤ Publish</h2>
        <span className="hd-meta">
          {props.ruleId} · 합성 {(props.composedBytes / 1024).toFixed(1)}KB · parent v{props.parentVersion}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' }}>
        <label className="hd-eyebrow">새 version</label>
        <input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="2026-05-23.005"
          style={{
            height: 34, padding: '0 10px',
            border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
            fontFamily: 'ui-monospace, monospace', fontSize: 13,
          }}
        />

        <label className="hd-eyebrow">notes (선택)</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="예: voice_studio_survey_build system fence 금지 추가"
          style={{
            height: 34, padding: '0 10px',
            border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
            fontSize: 13,
          }}
        />
      </div>

      {sameAsParent && (
        <div className="hd-meta" style={{ color: 'var(--hd-red)' }}>
          ⚠ version이 parent와 동일 — bump 필요
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="hd-btn primary"
          onClick={() => props.onPublish({ version: version.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}) })}
          disabled={!canPublish}
        >
          {props.busy ? '발행 중…' : '발행 (publish)'}
        </button>
      </div>

      {props.result && (
        <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-green)' }}>
          <div className="hd-meta" style={{ color: 'var(--hd-green)' }}>
            발행 완료 · {props.result.rule_id}@{props.result.version}
            {props.result.previous_version ? ` (이전 ${props.result.previous_version} → archived)` : ''}
            {' · '}fragments activated {props.result.fragments_activated.length}, archived {props.result.fragments_archived.length}
          </div>
        </div>
      )}
    </div>
  );
}
