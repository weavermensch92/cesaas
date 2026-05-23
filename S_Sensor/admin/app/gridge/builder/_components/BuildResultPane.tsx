'use client';
import { useMemo } from 'react';
import { findPathLabel } from '@/lib/gridge_paths';

interface Props {
  targetRuleId: string;
  targetPath: string;
  generatedYaml: string;
  onYamlChange: (next: string) => void;
  onRebuild: () => void;
  onNext: () => void;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  busy: boolean;
}

export function BuildResultPane(props: Props) {
  const bytes = useMemo(() => new TextEncoder().encode(props.generatedYaml).length, [props.generatedYaml]);
  const lines = props.generatedYaml.split('\n').length;
  const parseErr = tryParse(props.generatedYaml);

  return (
    <div className="hd-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 className="hd-h2" style={{ margin: 0 }}>③ Review — 생성된 fragment 검토·편집</h2>
        <span className="hd-meta">
          {props.targetRuleId} · {findPathLabel(props.targetRuleId, props.targetPath)}
        </span>
      </div>

      {parseErr && (
        <div className="hd-card" style={{ padding: 10, borderColor: 'var(--hd-red)' }}>
          <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>YAML parse 오류: {parseErr}</span>
        </div>
      )}

      <label className="hd-eyebrow" style={{ display: 'block' }}>
        generated_yaml ({(bytes / 1024).toFixed(1)}KB · {lines} lines{props.model ? ` · ${props.model}` : ''}
        {props.usage?.output_tokens != null ? ` · out ${props.usage.output_tokens}t` : ''})
      </label>
      <textarea
        value={props.generatedYaml}
        onChange={(e) => props.onYamlChange(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%', minHeight: 360, padding: 12,
          border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
          fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
          fontSize: 12, lineHeight: 1.55,
          whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto',
          resize: 'vertical',
        }}
      />

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="hd-btn" onClick={props.onRebuild} disabled={props.busy}>
          ← 자연어 수정 후 다시 빌드
        </button>
        <button
          className="hd-btn primary"
          onClick={props.onNext}
          disabled={props.busy || !!parseErr || props.generatedYaml.trim().length < 5}
        >
          미리보기로 진행 →
        </button>
      </div>
    </div>
  );
}

function tryParse(yaml: string): string | null {
  if (!yaml || !yaml.trim()) return 'YAML 비어있음';
  // 클라이언트 측 빠른 검증 — 정밀 검증은 publish 시 백엔드가 한 번 더 함
  // 단순 indentation·콜론 패턴 체크만. yaml lib는 무거우니 backend 의존.
  const lines = yaml.split('\n');
  let hasKey = false;
  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '');
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^[A-Za-z0-9_]+:\s*/.test(trimmed) || trimmed.startsWith('- ')) { hasKey = true; break; }
  }
  if (!hasKey) return 'key: value 라인이 없음';
  return null;
}
