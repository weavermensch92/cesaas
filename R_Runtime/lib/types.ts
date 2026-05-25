// harness2/lib/types.ts — R_10 룰과 코드 사이의 공통 인터페이스.
// PRD-03 § 4 R-020. harness1 원본을 prd-v1 컨벤션으로 포팅.

// ============================================================================
// § 1. 룰 메타 (모든 R_10 YAML 공통)
// ============================================================================

export type Severity = 'MUST' | 'SHOULD' | 'MAY';
export type RuleStatus = 'active' | 'not_implemented' | 'deprecated';
export type V1V2 = 'v1' | 'v2' | 'v3';

export interface RuleMeta {
  rule_id: string;           // 'R_10.01_LeadScoring'
  version: number;           // 정수 (DB rule_versions.current_version과 비교)
  description: string;
  harness: 1 | 2;
  v1_v2: V1V2;
  status?: RuleStatus;       // default 'active'
  last_modified: string;     // ISO 8601
  modified_by: string;
}

// ============================================================================
// § 2. R_10.01 LeadScoring
// ============================================================================

export interface ScoringRule {
  id: string;                // 'R_10.01.001_nps_high'
  description: string;
  condition: string;         // 'response.nps >= 9'
  action: string;            // 'score += 30'
  severity: Severity;
}

export interface LeadScoringYaml extends RuleMeta {
  input_schema: Record<string, unknown>;
  rules: ScoringRule[];
  output: {
    type: 'int';
    clamp_min: number;
    clamp_max: number;
    default: number;
  };
}

// ============================================================================
// § 3. R_10.02 LeadQuality
// ============================================================================

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface QualityThreshold {
  id: string;
  description: string;
  condition: string;         // 'score >= 80'
  grade: Grade;
  severity: Severity;
}

export interface LeadQualityYaml extends RuleMeta {
  input_schema: Record<string, unknown>;
  thresholds: QualityThreshold[];
  output: {
    type: 'string';
    enum: Grade[];
    default: Grade;
  };
}

// ============================================================================
// § 4. R_10.05 Classification
// ============================================================================

// CTT Moscow 2026 dealer survey_v2_dealer_ctt 의 8 segment.
// legacy 6개(construction_heavy / agriculture / forestry / general_construction / rental / other)는
// 기존 leads.segment row 호환을 위해 한시 보존. Phase 6 백필 후 별도 PR로 제거.
export type Segment =
  // CTT v2 — 8 segment
  | 'individual'
  | 'fleet_rental'
  | 'key_account'
  | 'mining'
  | 'infrastructure'
  | 'agri_plantation'
  | 'quarry'
  | 'gov_public'
  // legacy v1 — 한시 보존
  | 'construction_heavy'
  | 'agriculture'
  | 'forestry'
  | 'general_construction'
  | 'rental'
  | 'other';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export type ScreenType =
  | 'deal_list'
  | 'deal_detail'
  | 'company'
  | 'contact'
  | 'activity'
  | 'funnel'
  | 'task';

export interface SegmentRule {
  id: string;
  description: string;
  condition: string;
  segment: Segment;
  severity: Severity;
}

export interface ScreenPattern {
  screen: ScreenType;
  url_regex: string;
}

export interface PriorityRule {
  id: string;
  description: string;
  condition: string;
  priority: Priority;
  severity: Severity;
}

export interface ClassificationYaml extends RuleMeta {
  voice_segment: SegmentRule[];
  sensor_screen: {
    source: string;
    default_crm: string;
    fallback_classifier?: string;
    bitrix24_patterns: ScreenPattern[];
    [crm: string]: unknown;
  };
  lead_priority: PriorityRule[];
}

// ============================================================================
// § 5. R_10.06 PromptTemplates
// ============================================================================

export interface PromptTemplate {
  id: string;
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  user?: string;
  user_template?: string;
}

export interface PromptTemplatesYaml extends RuleMeta {
  templates: {
    sensor_13_fields: PromptTemplate;
    segment_classifier?: PromptTemplate;
    crm_screen_identifier?: PromptTemplate;
    [key: string]: PromptTemplate | undefined;
  };
  multi_image_guide?: {
    max_images: number;
    ordering: 'chronological' | 'any';
    diversification: boolean;
  };
}

// ============================================================================
// § 6. R_10.07 DealerOutput
// ============================================================================

export interface AxisOverride {
  // R_10.07 v2 — Top-2 axis pair별 가산 weapons / pitch.
  // key는 알파벳 정렬한 두 axis '+' join (예: 'durability+fuel', 'price+service').
  weapons?: string[];
  pitch_examples_ko?: string[];
  pitch_examples_ru?: string[];
}

export interface PlaybookEntry {
  id: string;
  description: string;
  sales_weapons: string[];
  pitch_examples: string[];
  related_models: string[];
  next_action_template: string;
  // prd-v1 다국어 확장 — R_10.07 YAML이 이 키들도 사용
  title_ko?: string;
  title_ru?: string;
  talking_points_ko?: string[];
  talking_points_ru?: string[];
  pitch_examples_ko?: string[];
  pitch_examples_ru?: string[];
  // R_10.07 v2 — Top-2 axis pair → override
  axis_overrides?: Record<string, AxisOverride>;
}

export interface PriorityTemplate {
  id: string;
  label: string;
  icon: string;
  next_action: string;
  rationale_template?: string;
}

export interface DealerOutputYaml extends RuleMeta {
  playbook: Record<Segment, PlaybookEntry>;
  lead_priority_template: Record<Priority, PriorityTemplate>;
  output_format: {
    default: 'markdown' | 'json';
    language: string;
    language_fallback: string[];
  };
}

// ============================================================================
// § 7. R_10.08 SurveyBuildPrompt · § 8. R_10.09 DataPointToQuestion
// ============================================================================

export interface SurveyBuildYaml extends RuleMeta {
  templates: {
    survey_builder: PromptTemplate;
  };
  output_schema: {
    example: string;
  };
}

export interface DataPointCategory {
  id: string;
  label_ko?: string;
  label_ru?: string;
  examples: string[];
}

export interface DataPointToQuestionYaml extends RuleMeta {
  templates: {
    data_point_converter: PromptTemplate;
  };
  data_point_categories: DataPointCategory[];
}

// ============================================================================
// § 9. 비즈니스 데이터 (입력 / 출력)
// ============================================================================

export interface VoiceResponse {
  nps?: number;
  future_subscription?: boolean;
  axis?: {
    // legacy v1
    scale?: 'S' | 'M' | 'L' | 'XL';
    usage?: string;
    annual_operating_hours?: 'low' | 'mid' | 'high';
    annual_deal_rub?: number | string;
    decision_role?: string;
    // CTT v2 — survey_v2_dealer_ctt 18문항
    work_env?: string;
    fleet_size?: 'S' | 'M' | 'L' | 'XL' | number;
    annual_budget?: 'XS' | 'S' | 'M' | 'L' | 'XL';
    annual_days?: 'lt_100' | '100_200' | '200_300' | 'gte_300';
    role?: 'individual' | 'committee' | 'executive' | 'hq_approval';
    daily_hours?: 'lt_4' | '4_8' | '8_12' | 'gte_12';
    severity?: number;
    service_sat?: number;
    self_report_ranks?: string[];     // ['service','fuel','durability'] 순위 보존
    pain_points?: string[];
    current_brands?: string[];
    purchase_mode?: 'cash' | 'lease' | 'financing' | 'rental_first';
    plan_12m?: 'none' | 'considering' | 'within_12m' | 'within_6m' | 'within_3m';
    equip_types?: string[];
    booth_interest?: string[];
    channel?: 'whatsapp' | 'telegram' | 'email' | 'phone' | 'none';
    heatmap_scores?: Partial<Record<
      'price' | 'fuel' | 'durability' | 'service' | 'reference' | 'versatility',
      number
    >>;
  };
  [extra: string]: unknown;
}

export interface LeadInput {
  segment?: Segment;
  sensor_activity_count?: number;
  deal_amount_rub?: number;
  region?: string;
  [extra: string]: unknown;
}

export interface EvaluationContext {
  response?: VoiceResponse;
  lead?: LeadInput;
  axis?: VoiceResponse['axis'];
  score?: number;
  [extra: string]: unknown;
}

export interface ScoringResult {
  score: number;
  applied_rules: { id: string; delta: number }[];
}

export interface ClassificationResult {
  segment?: Segment;
  screen?: ScreenType;
  priority?: Priority;
  confidence?: number;
}
