'use client';
import { useMemo } from 'react';
import { GRIDGE_PATH_GROUPS, findGroup, type PathOption } from '@/lib/gridge_paths';

interface Props {
  targetRuleId: string;
  targetPath: string;
  nlText: string;
  onChange: (next: { targetRuleId?: string; targetPath?: string; nlText?: string }) => void;
  onBuild: () => void;
  busy: boolean;
}

const EXAMPLES: { rule: string; path: string; text: string; label: string }[] = [
  {
    rule: 'R_10.06_PromptTemplates',
    path: 'templates.voice_studio_survey_build',
    label: '예) Studio system 강화',
    text: '나머지는 그대로 두고 system 마지막 줄에 "응답은 반드시 valid JSON 한 덩어리이며 markdown fence(```json …```)는 절대 출력하지 말 것"을 추가. max_tokens는 8000, model은 claude-sonnet-4-6.',
  },
  {
    rule: 'R_10.05_Classification',
    path: 'voice_segment',
    label: '예) 광업·임업 우선',
    text: '광업(usage=mining 또는 scale=mining)을 최우선으로 segment=mining 매칭, 그 다음 임업(usage=forestry)을 segment=forestry. 그 외 기존 룰 유지.',
  },
  {
    rule: 'R_10.02_LeadQuality',
    path: 'thresholds',
    label: '예) 임계 완화',
    text: 'A는 75 이상 (이전 80), B는 45~75, C는 20~45, D는 0~20. 등급별 playbook_hint 그대로.',
  },
];

export function BriefPane(props: Props) {
  const group = useMemo(() => findGroup(props.targetRuleId), [props.targetRuleId]);
  const paths: PathOption[] = group?.paths ?? [];
  const canBuild = !props.busy && props.targetRuleId && props.targetPath && props.nlText.trim().length >= 8;

  return (
    <div className="hd-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      <h2 className="hd-h2" style={{ margin: 0 }}>① Brief — 자연어로 룰 fragment 작성</h2>
      <p className="hd-meta" style={{ margin: 0 }}>
        target rule + path를 고르고, 의도를 자연어로 적으면 R_10.11이 그 위치에 들어갈 YAML 조각을 생성합니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' }}>
        <label className="hd-eyebrow">target_rule_id</label>
        <select
          value={props.targetRuleId}
          onChange={(e) => props.onChange({ targetRuleId: e.target.value, targetPath: '' })}
          style={selectStyle}
        >
          <option value="">선택…</option>
          {GRIDGE_PATH_GROUPS.map((g) => (
            <option key={g.rule_id} value={g.rule_id}>{g.rule_label}</option>
          ))}
        </select>

        <label className="hd-eyebrow">target_path</label>
        <select
          value={props.targetPath}
          onChange={(e) => props.onChange({ targetPath: e.target.value })}
          disabled={!group}
          style={selectStyle}
        >
          <option value="">선택…</option>
          {paths.map((p) => (
            <option key={p.path} value={p.path}>{p.label} ({p.path})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="hd-eyebrow" style={{ display: 'block', marginBottom: 4 }}>
          자연어 의도 ({props.nlText.length} chars, min 8)
        </label>
        <textarea
          value={props.nlText}
          onChange={(e) => props.onChange({ nlText: e.target.value })}
          placeholder="예) system 마지막 줄에 '응답은 반드시 valid JSON 한 덩어리, markdown fence 금지' 추가. 나머지 그대로."
          spellCheck={false}
          style={{
            width: '100%', minHeight: 200, padding: 12,
            border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
            fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
            fontSize: 13, lineHeight: 1.55,
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        <span className="hd-meta" style={{ alignSelf: 'center', marginRight: 6 }}>예제:</span>
        {EXAMPLES.map((e, i) => (
          <button
            key={i}
            className="hd-btn"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => props.onChange({ targetRuleId: e.rule, targetPath: e.path, nlText: e.text })}
            disabled={props.busy}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          className="hd-btn primary"
          onClick={props.onBuild}
          disabled={!canBuild}
        >
          {props.busy ? 'AI 변환 중…' : 'AI 빌드 →'}
        </button>
      </div>
    </div>
  );
}

const selectStyle = {
  height: 34, padding: '0 10px',
  border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
  fontSize: 13, background: '#fff',
};
