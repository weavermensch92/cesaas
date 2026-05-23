/**
 * R_10 룰별 schema_hint — R_10.11 rule_fragment_build 프롬프트에 주입되는 키 가이드.
 * 자연어 변환 AI가 어떤 키 구조로 출력해야 하는지 알려주는 짧은 명세.
 *
 * fragment_path 별 schema는 본 모듈에서 lookup. 미정의 path는 '자유 형식'으로 처리.
 */

interface PathSchema {
  description: string;
  example: string;
}

interface RuleSchema {
  rule_id: string;
  paths: Record<string, PathSchema>;
}

const SCHEMAS: RuleSchema[] = [
  {
    rule_id: 'R_10.06_PromptTemplates',
    paths: {
      'templates.voice_studio_survey_build': {
        description: 'Studio 자연어 → 설문 spec JSON 변환 LLM template. 키: id·model·max_tokens·temperature·system·user.',
        example: `id: R_10.06.003
model: claude-sonnet-4-6
max_tokens: 8000
temperature: 0
system: |
  당신은 HD건설기계 러시아 영업 설문 빌더이다.
  ... (다국어·6 axis·NPS·consent 명시)
user: |
  요청: {input}`,
      },
      'templates.voice_studio_survey_edit': {
        description: 'base_spec + edit_notes → 수정 spec LLM template. 키는 build와 동일.',
        example: `id: R_10.06.005
model: claude-sonnet-4-6
max_tokens: 8000
temperature: 0
system: |
  기존 spec을 edit_notes 요구에 맞춰 수정/보강.
user: |
  base_spec + edit_notes`,
      },
      'templates.sensor_13_fields': {
        description: 'Bitrix24 캡쳐 1~5장 → 13 표준 필드 JSON 추출. Vision 사용 (multi_image).',
        example: `id: R_10.06.001
model: claude-opus-4-7
max_tokens: 2000
temperature: 0
system: |
  당신은 CRM 화면 데이터 추출기. 13 필드 + confidence JSON.
user: |
  이미지 1~5장의 동일 deal entity. schema 13 키.`,
      },
      'templates.sensor_screen_classify': {
        description: '단일 캡쳐 → 화면 종류 enum (deal_list·deal_detail·company·contact·activity·funnel·task·unknown).',
        example: `id: R_10.06.002
model: claude-opus-4-7
max_tokens: 200
temperature: 0
system: |
  스크린샷 1장 → {kind, confidence} JSON.
user: |
  이미지의 화면 종류.`,
      },
      'templates.segment_classifier': {
        description: '6 axis 응답 → segment 1개 분류 (deterministic 룰 실패 시 LLM 보조).',
        example: `id: R_10.06.004
model: claude-haiku-4-5-20251001
max_tokens: 200
temperature: 0
system: |
  6 axis → segment ∈ {mining,key_account,construction_heavy,agriculture,forestry,general_construction,rental,other}.
user: |
  axis 응답:
  {axis_json}
  segment JSON.`,
      },
    },
  },
  {
    rule_id: 'R_10.05_Classification',
    paths: {
      'voice_segment': {
        description: '6 axis → segment deterministic 매칭 룰 배열. 위에서 아래로 평가, 첫 match 적용.',
        example: `- when: "scale == 'mining'"
  set_segment: mining
  label_ko: 광업
  label_ru: Горнодобыча
- when: "annual_deal_rub == 'large' OR fleet_size >= 50"
  set_segment: key_account`,
      },
      'sensor_screen': {
        description: 'CRM URL pattern → screen_kind 매핑.',
        example: `- when: "url contains '/crm/deal/details/'"
  kind: deal_detail
- when: "url contains '/crm/deal/list/'"
  kind: deal_list`,
      },
      'lead_priority': {
        description: 'segment·score → P1~P5 우선순위 매핑.',
        example: `- when: "segment == 'key_account' AND score >= 80"
  priority: P1
- when: "score >= 60"
  priority: P2`,
      },
    },
  },
  {
    rule_id: 'R_10.07_DealerOutput',
    paths: {
      'playbook.mining': {
        description: 'mining segment 전용 Dealer Playbook. title·weapons[]·pitch·models[]·next_action.',
        example: `title: 광업 키 어카운트 — heavy duty 솔루션
weapons:
  - HD 광산 사양 보강 (cooling·dust filter)
  - 평균 가동 95%
pitch: |
  골재·시멘트·heavy duty 광산 환경에서 가동률 95% 보장.
models: [HX480, HX520]
next_action: 현장 데모 일정 제안`,
      },
      // 나머지 7 segment는 동일 형태 (key_account, construction_heavy, agriculture, forestry, general_construction, rental, other)
    },
  },
  {
    rule_id: 'R_10.01_LeadScoring',
    paths: {
      'rules': {
        description: 'when 조건 + action(점수 가감) 배열. action은 "score += N" / "score -= N" 형태.',
        example: `- when: "nps >= 9"
  action: "score += 20"
- when: "segment == 'key_account'"
  action: "score += 15"`,
      },
      'hd_strength_matrix': {
        description: 'HD가 강한 segment·priority 조합에 가중. key=segment, value=점수.',
        example: `mining: 10
key_account: 8
construction_heavy: 6`,
      },
    },
  },
  {
    rule_id: 'R_10.02_LeadQuality',
    paths: {
      'thresholds': {
        description: 'score → A/B/C/D 등급 매핑. min 포함, max 미포함.',
        example: `- min: 80
  grade: A
- min: 50
  max: 80
  grade: B
- min: 25
  max: 50
  grade: C
- min: 0
  max: 25
  grade: D`,
      },
    },
  },
  {
    rule_id: 'R_10.09_DataPointToQuestion',
    paths: {
      'templates.data_point_converter': {
        description: '추적할 데이터포인트 → 질문 JSON (직접·우회·검증 조합).',
        example: `id: R_10.09.001
model: claude-opus-4-7
max_tokens: 4000
temperature: 0
system: |
  데이터포인트 list → 질문 max 5개 JSON.
user: |
  데이터포인트: {points}`,
      },
    },
  },
  {
    rule_id: 'R_10.10_DecisionWeight',
    paths: {
      'weight_matrix': {
        description: '간접 5질문 응답 → DW 6축(1~5) 가중치 매트릭스.',
        example: `Q3_prime:
  fleet_size_large: {price: 5, durability: 4, service: 3}
  fleet_size_small: {price: 3, durability: 5}`,
      },
      'rules': {
        description: '간접 응답 조합 → DW 축 보정 룰.',
        example: `- when: "annual_operating_hours > 2000"
  action: "dw.durability += 1"`,
      },
    },
  },
];

const FREE_FORM_SCHEMA: PathSchema = {
  description: '자유 형식 — 위버 자연어 의도에 따라 적절한 키 구조로 작성. parent YAML의 기존 동일 path 구조 참고.',
  example: '# 자유 형식',
};

export function getSchemaHint(ruleId: string, fragmentPath: string): string {
  const rule = SCHEMAS.find((r) => r.rule_id === ruleId);
  const path = rule?.paths[fragmentPath] ?? FREE_FORM_SCHEMA;
  return `${path.description}\n\n예시 출력:\n${path.example}`;
}

export function listKnownPaths(ruleId: string): string[] {
  const rule = SCHEMAS.find((r) => r.rule_id === ruleId);
  return rule ? Object.keys(rule.paths) : [];
}
