/**
 * R_10 룰별 target_path enum + 한국어 라벨.
 * 백엔드 `V_Voice/backend/shared/rule_schema_hints.ts` 와 짝 — path가 빠지면 자유 형식으로 처리됨.
 * Phase 2에서 동적 schema로 교체 예정.
 */

export interface PathOption {
  path: string;
  label: string;
  hint?: string;
}

export interface RulePathGroup {
  rule_id: string;
  rule_label: string;
  paths: PathOption[];
}

export const GRIDGE_PATH_GROUPS: RulePathGroup[] = [
  {
    rule_id: 'R_10.06_PromptTemplates',
    rule_label: 'R_10.06 — LLM 프롬프트',
    paths: [
      { path: 'templates.voice_studio_survey_build', label: 'Studio 자연어→설문 빌드', hint: '/studio의 "새 질문지 생성" 변환 룰' },
      { path: 'templates.voice_studio_survey_edit', label: 'Studio 설문 편집·재생성', hint: '/studio의 "기존 질문지 수정" 변환 룰' },
      { path: 'templates.sensor_13_fields', label: 'Sensor 13필드 추출 (Vision)', hint: 'CRM 스크린샷 → 13 표준 필드' },
      { path: 'templates.sensor_screen_classify', label: 'Sensor 화면 분류', hint: '단일 스크린샷 → 화면 종류 enum' },
      { path: 'templates.segment_classifier', label: 'Segment LLM 보조 분류', hint: 'deterministic 실패 시 LLM' },
    ],
  },
  {
    rule_id: 'R_10.05_Classification',
    rule_label: 'R_10.05 — 분류 룰',
    paths: [
      { path: 'voice_segment', label: 'Voice → segment 매칭', hint: '6 axis → 8 segment deterministic' },
      { path: 'sensor_screen', label: 'Sensor URL → screen_kind', hint: 'CRM URL pattern 매칭' },
      { path: 'lead_priority', label: 'Lead 우선순위', hint: 'segment·score → P1~P5' },
    ],
  },
  {
    rule_id: 'R_10.07_DealerOutput',
    rule_label: 'R_10.07 — Dealer Playbook',
    paths: [
      { path: 'playbook.mining', label: 'Playbook — 광업' },
      { path: 'playbook.key_account', label: 'Playbook — 키 어카운트' },
      { path: 'playbook.construction_heavy', label: 'Playbook — 중대형 건설' },
      { path: 'playbook.agriculture', label: 'Playbook — 농업' },
      { path: 'playbook.forestry', label: 'Playbook — 임업' },
      { path: 'playbook.general_construction', label: 'Playbook — 일반 건설' },
      { path: 'playbook.rental', label: 'Playbook — 렌탈·임대' },
      { path: 'playbook.other', label: 'Playbook — 기타' },
    ],
  },
  {
    rule_id: 'R_10.01_LeadScoring',
    rule_label: 'R_10.01 — Lead 점수',
    paths: [
      { path: 'rules', label: '점수 규칙 (when+action)' },
      { path: 'hd_strength_matrix', label: 'HD 강점 매트릭스' },
    ],
  },
  {
    rule_id: 'R_10.02_LeadQuality',
    rule_label: 'R_10.02 — Lead 등급',
    paths: [
      { path: 'thresholds', label: '점수 → A/B/C/D 임계' },
    ],
  },
  {
    rule_id: 'R_10.09_DataPointToQuestion',
    rule_label: 'R_10.09 — DataPoint→Question',
    paths: [
      { path: 'templates.data_point_converter', label: '데이터포인트 → 질문 변환' },
    ],
  },
  {
    rule_id: 'R_10.10_DecisionWeight',
    rule_label: 'R_10.10 — DW 6축',
    paths: [
      { path: 'weight_matrix', label: '간접 5질문 가중치' },
      { path: 'rules', label: 'DW 축 보정 룰' },
    ],
  },
];

export function findGroup(ruleId: string): RulePathGroup | undefined {
  return GRIDGE_PATH_GROUPS.find((g) => g.rule_id === ruleId);
}

export function findPathLabel(ruleId: string, path: string): string {
  const g = findGroup(ruleId);
  return g?.paths.find((p) => p.path === path)?.label ?? path;
}
