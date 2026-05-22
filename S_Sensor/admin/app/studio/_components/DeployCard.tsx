'use client';
import type { CSSProperties } from 'react';
import type { StudioDeploymentResult, StudioDeployError, StudioSurveySpec, StudioTarget } from '@/lib/api';

interface Props {
  targets: StudioTarget[];
  spec: StudioSurveySpec | undefined;
  archivePrev: boolean;
  deploying: boolean;
  deployed?: { deployments: StudioDeploymentResult[]; errors?: StudioDeployError[] };
  versionLabelInput: string;
  onVersionLabel: (s: string) => void;
  onArchivePrev: (v: boolean) => void;
  onDeploy: () => void;
  onRetryTarget?: (t: StudioTarget) => void;
  onCopyJson: () => void;
}

export function DeployCard(p: Props) {
  return (
    <section className="hd-card" style={{ marginTop: 12 }}>
      <div className="hd-card-hd">
        <span className="hd-card-title">3. 배포</span>
        {p.spec?.id && (
          <span className="hd-card-sub">{p.spec.id}</span>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {/* Settings */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="hd-eyebrow">targets</span>
          {p.targets.map((t) => <span key={t} style={targetBadge}>{t}</span>)}

          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)', margin: '0 4px' }} />

          <span className="hd-eyebrow">version_label</span>
          <input
            value={p.versionLabelInput}
            onChange={(e) => p.onVersionLabel(e.target.value)}
            placeholder="auto (자동 bump)"
            style={inputStyle}
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={p.archivePrev}
              onChange={(e) => p.onArchivePrev(e.target.checked)} />
            이전 active archive
          </label>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="hd-btn primary"
            onClick={p.onDeploy}
            disabled={p.deploying || !p.spec || p.targets.length === 0}>
            {p.deploying ? '배포 중…' : `배포 (${p.targets.length} target${p.versionLabelInput ? ` · v${p.versionLabelInput}` : ''})`}
          </button>
          <button className="hd-btn ghost sm" onClick={p.onCopyJson} disabled={!p.spec}>
            JSON 복사
          </button>
          <span className="hd-meta" style={{ marginLeft: 'auto' }}>
            surveys + survey_questions 트랜잭션 INSERT · target별 순차 RPC
          </span>
        </div>

        {/* Result */}
        {p.deployed && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {p.deployed.deployments.map((d) => (
              <div key={d.target_audience} style={successRow}>
                <strong style={{ color: 'var(--hd-prosperity)' }}>✓ {d.target_audience}</strong>
                <code style={codeStyle}>{d.survey_id}</code>
                {d.version_label && <span style={versionPill}>v{d.version_label}</span>}
                <span className="hd-meta" style={{ marginLeft: 'auto' }}>{d.deployed_at}</span>
              </div>
            ))}
            {p.deployed.errors?.map((e) => (
              <div key={e.target_audience} style={errorRow}>
                <strong style={{ color: 'var(--hd-red)' }}>✗ {e.target_audience}</strong>
                <span className="hd-meta">{e.code}: {e.message}</span>
                {p.onRetryTarget && (
                  <button className="hd-btn ghost sm"
                    onClick={() => p.onRetryTarget!(e.target_audience)}
                    style={{ marginLeft: 'auto' }}>재시도</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const inputStyle: CSSProperties = {
  width: 90, height: 28, padding: '0 8px',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  font: 'inherit', fontSize: 12,
};
const targetBadge: CSSProperties = {
  fontSize: 11, fontWeight: 600,
  padding: '2px 8px', borderRadius: 4,
  background: 'var(--hd-steel-100)', color: 'var(--hd-trust)',
};
const codeStyle: CSSProperties = {
  background: 'var(--hd-steel-50)', padding: '2px 6px', borderRadius: 4,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11,
};
const versionPill: CSSProperties = {
  fontSize: 11, fontWeight: 600,
  padding: '2px 8px', borderRadius: 12,
  background: 'var(--hd-accent-50)', color: 'var(--hd-prosperity)',
};
const successRow: CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
  padding: '6px 10px',
  background: 'var(--hd-accent-50)',
  borderRadius: 4,
};
const errorRow: CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
  padding: '6px 10px',
  background: '#fef3f2',
  borderRadius: 4,
};
