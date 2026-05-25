'use client';
import { getSupabase } from './supabase';

const API_BASE =
  process.env['NEXT_PUBLIC_API_BASE'] ??
  (process.env['NEXT_PUBLIC_SUPABASE_URL']
    ? `${process.env['NEXT_PUBLIC_SUPABASE_URL']}/functions/v1`
    : '');

async function authHeaders(): Promise<Record<string, string>> {
  const supa = getSupabase();
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not signed in');
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  query?: Record<string, string | undefined | null>,
  body?: unknown,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      ...(await authHeaders()),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    throw new ApiClientError(res.status, parsed);
  }
  return res.json() as Promise<T>;
}

export class ApiClientError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// -------- Types --------

export interface CaptureListItem {
  id: string;
  created_at: string;
  captured_at: string;
  dealer_id: string;
  crm_id: string;
  url_path: string;
  screen_type: string | null;
  entity_id: string | null;
  status: string;
  image_path: string | null;
  classification_confidence: number | null;
  thumbnail_url: string | null;
}

export interface PaginatedCaptures {
  data: CaptureListItem[];
  next_cursor: string | null;
}

export interface CaptureListFilters {
  dealer_id?: string;
  crm_id?: string;
  screen_type?: string;
  status?: string;
  entity_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ClusterDetail {
  cluster: {
    id: string;
    entity_id: string;
    crm_id: string;
    capture_ids: string[];
    image_count: number;
    status: string;
    normalized_fields_id: string | null;
    normalized_at: string | null;
    created_at: string;
  };
  captures: Array<{
    id: string;
    dealer_id: string;
    screen_type: string | null;
    classification_confidence: number | null;
    captured_at: string;
    image_url: string | null;
    status: string;
  }>;
  normalized: {
    id: string;
    model: string;
    prompt_version: string;
    created_at: string;
    edited_by: string | null;
    edited_at: string | null;
    fields: Record<string, { value: unknown; confidence: number | null }>;
  } | null;
  edits: Array<{
    id: string;
    field_name: string;
    llm_value: string | null;
    llm_confidence: number | null;
    edited_value: string | null;
    edited_by: string;
    reason: string | null;
    created_at: string;
    prompt_version: string | null;
  }>;
  queue: Array<{
    id: string;
    status: string;
    priority: string;
    attempts: number;
    last_error: string | null;
    enqueued_at: string;
    started_at: string | null;
    completed_at: string | null;
  }>;
}

// -------- Calls --------

export async function listCaptures(filters: CaptureListFilters): Promise<PaginatedCaptures> {
  return request('GET', '/admin-captures', {
    dealer_id: filters.dealer_id,
    crm_id: filters.crm_id,
    screen_type: filters.screen_type,
    status: filters.status,
    entity_id: filters.entity_id,
    from: filters.from,
    to: filters.to,
    limit: filters.limit?.toString(),
    cursor: filters.cursor ?? undefined,
  });
}

export async function getCluster(id: string): Promise<ClusterDetail> {
  return request('GET', '/admin-clusters', { id });
}

export async function getClusterByEntity(entityId: string, crmId: string): Promise<ClusterDetail> {
  return request('GET', '/admin-clusters', { entity_id: entityId, crm_id: crmId });
}

export async function editField(args: {
  normalized_id: string;
  field_name: string;
  new_value: string | null;
  reason?: string;
}): Promise<{ edit_id: string; status: 'ok' }> {
  return request('PATCH', '/admin-field-edit', undefined, args);
}

export async function triggerNormalize(args: {
  cluster_id: string;
  priority?: 'high' | 'normal' | 'low';
  reason?: string;
}): Promise<{ queue_id: string; cluster_id: string; enqueued_at: string }> {
  return request('POST', '/admin-normalize-trigger', undefined, args);
}

// ============================================================================
// V_Voice — Voice admin (V_30)
// ============================================================================

export interface VoiceResponseRow {
  id: string;
  created_at: string;
  captured_at: string;
  respondent_type: 'dealer' | 'visitor';
  dealer_id: string | null;
  device_id: string | null;
  event: string | null;
  language: string | null;
  nps: number | null;
  segment: string | null;
  segment_confidence: number | null;
  segment_method: string | null;
  future_subscription: boolean | null;
  consent_data_collection: boolean | null;
  contact_opted_in: boolean | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  axis_data: Record<string, unknown> | null;
  pii_redacted_at: string | null;
  target_company: string | null;
  notes: string | null;
}

export interface VoiceListFilters {
  respondent_type?: 'dealer' | 'visitor';
  segment?: string;
  event?: string;
  from?: string;
  to?: string;
  nps_min?: number;
  nps_max?: number;
  contact_opted_in?: 'true' | 'false';
  dealer_id?: string;
  target_company?: string;
  limit?: number;
  cursor?: string | null;
}

export interface PaginatedVoiceResponses {
  data: VoiceResponseRow[];
  next_cursor: string | null;
}

export interface VoiceAggregates {
  total: number;
  by_segment: Array<{ segment: string; dealer: number; visitor: number; total: number }>;
  nps: {
    count: number; avg: number | null;
    detractors: number; passives: number; promoters: number;
  };
  by_event: Array<{ event: string; count: number }>;
  by_language: Array<{ language: string; count: number }>;
  truncated: boolean;
}

export async function listVoiceResponses(filters: VoiceListFilters): Promise<PaginatedVoiceResponses> {
  return request('GET', '/voice-responses', {
    respondent_type: filters.respondent_type,
    segment: filters.segment,
    event: filters.event,
    from: filters.from,
    to: filters.to,
    nps_min: filters.nps_min?.toString(),
    nps_max: filters.nps_max?.toString(),
    contact_opted_in: filters.contact_opted_in,
    dealer_id: filters.dealer_id,
    target_company: filters.target_company,
    limit: filters.limit?.toString(),
    cursor: filters.cursor ?? undefined,
  });
}

export async function getVoiceAggregates(filters: { from?: string; to?: string; event?: string }): Promise<VoiceAggregates> {
  return request('GET', '/voice-aggregates', {
    from: filters.from, to: filters.to, event: filters.event,
  });
}

// CTT 2026 — 8 segment × 6 axis 히트맵.
export type HeatmapTier = 'primary' | 'secondary' | 'base' | 'none';
export type HeatmapAxis = 'price' | 'fuel' | 'durability' | 'service' | 'reference' | 'versatility';
export interface VoiceHeatmapCell { avg: number; n: number; tier: HeatmapTier }
export interface VoiceHeatmapRow {
  segment: string;
  respondents: number;
  axes: Record<HeatmapAxis, VoiceHeatmapCell>;
}
export interface VoiceHeatmap {
  matrix: VoiceHeatmapRow[];
  totals: { respondents: number; by_segment: Record<string, number> };
  tier_thresholds: { primary: number; secondary: number; base: number };
  survey_id: string;
  truncated: boolean;
}
export async function getVoiceHeatmap(filters: {
  from?: string; to?: string; event?: string; survey_id?: string;
} = {}): Promise<VoiceHeatmap> {
  return request('GET', '/voice-heatmap', {
    from: filters.from, to: filters.to, event: filters.event, survey_id: filters.survey_id,
  });
}

// V-034 — 실시간 응답률·에러 카드 (Admin /voice/aggregates 폴링).
export interface VoiceRealtimeWindow {
  total: number;
  dealer: number;
  visitor: number;
  errors: number;
  per_min: number;
}
export interface VoiceRealtime {
  now: string;
  event: string | null;
  windows: {
    last_5m: VoiceRealtimeWindow;
    last_1h: VoiceRealtimeWindow;
    last_24h: VoiceRealtimeWindow;
  };
  last_response_at: string | null;
  lookback_min_rate: { window_min: number; total: number; per_min: number };
}
export async function getVoiceRealtime(opts: { event?: string; lookback_min?: number } = {}): Promise<VoiceRealtime> {
  return request('GET', '/voice-realtime', {
    event: opts.event,
    lookback_min: opts.lookback_min?.toString(),
  });
}

/**
 * CSV는 binary 다운로드 — request() 헬퍼 대신 직접 fetch + Blob.
 */
export async function downloadVoiceCsv(filters: VoiceListFilters & { anonymize?: boolean }): Promise<void> {
  const supa = getSupabase();
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not signed in');

  const base = process.env['NEXT_PUBLIC_API_BASE'] ??
    (process.env['NEXT_PUBLIC_SUPABASE_URL']
      ? `${process.env['NEXT_PUBLIC_SUPABASE_URL']}/functions/v1`
      : '');
  const url = new URL(`${base}/voice-csv-export`);
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiClientError(res.status, text);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const disposition = res.headers.get('content-disposition') || '';
  const m = /filename="([^"]+)"/.exec(disposition);
  const filename = m?.[1] ?? `hd-voice-${Date.now()}.csv`;
  const a = document.createElement('a');
  a.href = objUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

// ============================================================================
// V_30.04 Dealer Tokens — Admin이 딜러 계정(Bearer JWT) 발급·revoke
// ============================================================================

export interface DealerTokenRow {
  id: string;
  dealer_id: string;
  event: string;
  jti: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  label: string | null;
  issued_by: string | null;
  response_count: number;
}

export interface PaginatedDealerTokens {
  data: DealerTokenRow[];
  next_cursor: string | null;
}

export interface DealerTokenListFilters {
  event?: string;
  include_revoked?: boolean;
  include_expired?: boolean;
  limit?: number;
  cursor?: string | null;
}

export interface DealerTokenIssueResult {
  jti: string;
  dealer_id: string;
  event: string;
  issued_at: string;
  expires_at: string;
  label: string | null;
  issued_by: string | null;
  url: string;
  jwt: string;
}

export async function listDealerTokens(f: DealerTokenListFilters): Promise<PaginatedDealerTokens> {
  return request('GET', '/dealer-tokens-list', {
    event: f.event,
    include_revoked: f.include_revoked ? 'true' : undefined,
    include_expired: f.include_expired ? 'true' : undefined,
    limit: f.limit?.toString(),
    cursor: f.cursor ?? undefined,
  });
}

export async function issueDealerToken(args: {
  dealer_id: string;
  event: string;
  ttl_hours?: number;
  label?: string;
}): Promise<DealerTokenIssueResult> {
  return request('POST', '/dealer-tokens-issue', undefined, args);
}

export async function revokeDealerToken(jti: string): Promise<{
  id: string; dealer_id: string; event: string; jti: string; revoked_at: string; revoked_by: string;
}> {
  return request('PATCH', '/dealer-tokens-revoke', undefined, { jti });
}

// ============================================================================
// V_60 Studio v2 — 다중 채널·기존 수정·lint warnings·AI/edited 배지
// ============================================================================

export type StudioTarget = 'dealer' | 'visitor';

export interface StudioQuestion {
  id?: string;
  type: 'single_select' | 'multi_select' | 'scale_1_5' | 'scale_1_10' | 'nps' | 'text_short' | 'text_long' | 'number' | 'slider' | 'consent';
  title_ru: string;
  title_en?: string;
  title_ko?: string;
  axis?: string;
  options?: Array<{ value: string; label_ru: string; label_en?: string; label_ko?: string }>;
  required?: boolean;
  weight?: number;
  sort_order?: number;
  /** 신규(035) — LLM이 생성·갱신한 질문. 사용자 편집 시 false 로 토글. */
  ai_generated?: boolean;
  /** 신규(035) — row-level edited timestamp (사용자가 어떤 필드든 손대면 갱신, regenerate 시 null). */
  edited_at?: string | null;
}

export interface StudioSurveySpec {
  id?: string;
  slug?: string;
  title: string;
  description?: string;
  language_default?: 'ru' | 'en' | 'ko';
  estimated_minutes?: number;
  questions: StudioQuestion[];
}

export interface StudioLintWarning {
  code: 'time_overrun' | 'missing_required' | 'language_gap' | 'merge_candidate' | 'option_imbalance';
  severity: 'warn' | 'error';
  question_ids: string[];
  message_ko: string;
  suggestion_patch?: Partial<StudioSurveySpec> | { questions?: Array<Partial<StudioQuestion>> };
}

export interface StudioDraftEntry {
  target_audience: StudioTarget;
  draft_id?: string;
  spec?: StudioSurveySpec;
  warnings?: StudioLintWarning[];
  model?: string;
  rule_version?: string;
  prompt_version?: string | null;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { code: string; message: string };
}

export interface StudioBuildResultV2 {
  brief_group_id: string;
  drafts: StudioDraftEntry[];
}

export async function studioBuildSurvey(args: {
  input_text: string;
  target_audiences: StudioTarget[];
  language?: 'ko' | 'en' | 'ru';
  base_spec?: StudioSurveySpec;
  edit_notes?: string;
  parent_survey_id?: string;
}): Promise<StudioBuildResultV2> {
  return request('POST', '/studio-build-survey', undefined, args);
}

export interface StudioDeploymentResult {
  target_audience: StudioTarget;
  survey_id: string;
  version_label?: string;
  deployed_at: string;
}

export interface StudioDeployError {
  target_audience: StudioTarget;
  code: string;
  message: string;
}

export interface StudioDeployResponse {
  brief_group_id?: string;
  deployments: StudioDeploymentResult[];
  errors?: StudioDeployError[];
}

export async function studioDeploy(args: {
  deployments: Array<{
    target_audience: StudioTarget;
    spec: StudioSurveySpec;
    draft_id?: string;
    version_label?: string;
  }>;
  brief_group_id?: string;
  archive_previous?: boolean;
}): Promise<StudioDeployResponse> {
  return request('POST', '/studio-deploy', undefined, args);
}

// ─── 기존 설문 로드/목록 (Studio v2 신규) ─────────────────────────────────

export interface StudioSurveyListItem {
  id: string;
  title: string;
  target_audience: StudioTarget;
  version_label?: string;
  status: 'active' | 'draft' | 'archived';
  language_default: string;
  estimated_minutes?: number;
  question_count: number;
  created_at: string;
  updated_at: string;
}

export async function studioSurveysList(opts: {
  target_audience?: StudioTarget;
  include_archived?: boolean;
} = {}): Promise<{ surveys: StudioSurveyListItem[] }> {
  return request('GET', '/studio-surveys-list', {
    target_audience: opts.target_audience,
    include_archived: opts.include_archived ? 'true' : undefined,
  });
}

export interface StudioLoadSurveyResult {
  draft_id: string;
  brief_group_id: string;
  target_audience: StudioTarget;
  spec: StudioSurveySpec;
  parent_survey: { id: string; title: string; version_label?: string; created_at: string };
}

export async function studioLoadSurvey(surveyId: string): Promise<StudioLoadSurveyResult> {
  return request('GET', '/studio-load-survey', { survey_id: surveyId });
}

// ============================================================================
// U_Unified — Lead 응집·DealerOutput
// ============================================================================

export interface LeadRow {
  id: string;
  crm_id: string;
  entity_id: string | null;
  score: number | null;
  priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | null;
  segment: string | null;
  status: string;
  sensor_count: number;
  voice_count: number;
  company_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  amount: number | null;
  currency: string | null;
  stage: string | null;
  product_model: string | null;
  first_seen_at: string;
  last_seen_at: string;
  score_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadFilters {
  priority?: string;
  segment?: string;
  crm_id?: string;
  has_sensor?: 'true' | 'false';
  has_voice?: 'true' | 'false';
  unassociated?: 'true' | 'false';   // U-004 — entity_id IS NULL 필터
  q?: string;
  status?: string;
  limit?: number;
  cursor?: string | null;
}

export interface PaginatedLeads {
  data: LeadRow[];
  next_cursor: string | null;
}

export interface LeadDetail {
  lead: LeadRow & { axis_data?: unknown; notes?: string | null };
  clusters: Array<{ id: string; entity_id: string; crm_id: string; image_count: number; status: string; normalized_at: string | null; updated_at: string; normalized_fields_id: string | null }>;
  responses: Array<{ id: string; respondent_type: 'dealer'|'visitor'; dealer_id: string | null; device_id: string | null; segment: string | null; nps: number | null; language: string | null; contact_opted_in: boolean | null; captured_at: string }>;
  normalized: Record<string, unknown> | null;
  dealer_output: {
    id: string; segment: string; priority: string; score_snapshot: number | null;
    title: string | null; source: 'rule'|'llm'; rule_version: string | null;
    created_at: string;
  } | null;
  links: Array<{ id: string; source_table: 'entity_clusters' | 'responses'; source_id: string; linked_at: string }>;
}

export async function listLeads(f: LeadFilters): Promise<PaginatedLeads> {
  return request('GET', '/admin-leads', {
    priority: f.priority, segment: f.segment, crm_id: f.crm_id,
    has_sensor: f.has_sensor, has_voice: f.has_voice,
    unassociated: f.unassociated,
    q: f.q, status: f.status,
    limit: f.limit?.toString(), cursor: f.cursor ?? undefined,
  });
}

export async function getLead(id: string): Promise<LeadDetail> {
  return request('GET', '/admin-leads-detail', { id });
}

// U-004 — entity_id 수동 연결. 충돌 시 409 + target_lead_id 포함하여 throw.
export interface AssociateLeadResult {
  lead: { id: string; entity_id: string; crm_id: string; company_name: string | null; segment: string | null; priority: string | null; score: number | null; grade: string | null };
  actor: string;
}
export async function associateLead(args: {
  lead_id: string;
  entity_id: string;
  crm_id?: string;
}): Promise<AssociateLeadResult> {
  return request('POST', '/admin-lead-associate', undefined, {
    lead_id: args.lead_id,
    entity_id: args.entity_id,
    crm_id: args.crm_id ?? 'bitrix24',
  });
}

// ============================================================================
// T_08 통과 판정
// ============================================================================

export interface TestMetric {
  id: string;
  label: string;
  hypothesis: string;
  source: string;
  threshold: string;
  unit?: string;
  current: number | string | null;
  status: 'pass' | 'warn' | 'fail' | 'insufficient_data';
  samples: number;
  note?: string;
}

export interface HypothesisBreakdown {
  hypothesis: string;
  pass: number;
  fail: number;
  skip: number;
  sample_metric_name: string | null;
  avg_metric: number | null;
}

export interface TestRunSummary {
  id: string;
  started_at: string;
  completed_at: string | null;
  suite: 'T_04' | 'T_05' | 'T_06';
  scenario: string;
  actor: string;
  status: 'running' | 'passed' | 'failed' | 'aborted';
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  duration_ms: number | null;
  notes: string | null;
}

export interface TestSummary {
  since: string;
  metrics: TestMetric[];
  hypothesis_breakdown: HypothesisBreakdown[];
  recent_runs: TestRunSummary[];
  verdict: {
    quantitative_passed: number;
    quantitative_total: number;
    quantitative_fail: number;
    status: 'pass' | 'partial' | 'fail' | 'insufficient_data';
  };
}

export async function getTestSummary(since?: string): Promise<TestSummary> {
  return request('GET', '/admin-test-summary', since ? { since } : undefined);
}

// ============================================================================
// LLM 운영 — API 키 회전 + 사용 현황
// ============================================================================

export interface AnthropicKeyMeta {
  present: boolean;
  last_4: string | null;
  updated_at: string | null;
}

export interface LlmUsageRow {
  day: string;
  function_name: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
  errors: number;
}

export interface LlmUsageByDay {
  day: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
}

export interface LlmUsageSummary {
  range: { days: number; since_iso: string };
  totals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_cost_usd: number;
    errors: number;
  };
  by_day: LlmUsageByDay[];
  rows: LlmUsageRow[];
}

export async function getAnthropicKeyMeta(): Promise<AnthropicKeyMeta> {
  const r = await request<{ anthropic_api_key: AnthropicKeyMeta }>('GET', '/admin-settings');
  return r.anthropic_api_key;
}

export async function rotateAnthropicKey(key: string): Promise<AnthropicKeyMeta> {
  const r = await request<{ anthropic_api_key: AnthropicKeyMeta }>(
    'PATCH', '/admin-settings', undefined, { anthropic_api_key: key },
  );
  return r.anthropic_api_key;
}

export async function getLlmUsage(days: number): Promise<LlmUsageSummary> {
  return request('GET', '/admin-llm-usage', { days: String(days) });
}

// ============================================================================
// Auth · 회원 관리
// ============================================================================

export type UserRole = 'super_admin' | 'admin' | 'regular';

export interface MeProfile {
  sub: string;
  email: string;
  role: UserRole;
  password_set: boolean;
}

export interface MemberRow {
  user_id: string;
  email: string;
  role: UserRole;
  password_set: boolean;
  created_at: string;
  last_login_at: string | null;
  invited_by_email: string | null;
  deleted_at: string | null;
}

export async function getMe(): Promise<MeProfile> {
  return request('GET', '/auth-me');
}

export async function markPasswordSet(): Promise<{ status: 'ok' }> {
  return request('POST', '/auth-mark-password-set', undefined, {});
}

export async function listMembers(): Promise<{ data: MemberRow[] }> {
  return request('GET', '/admin-members');
}

export async function inviteMember(email: string, role: UserRole): Promise<{ status: 'invited' | 're_invited' }> {
  return request('POST', '/admin-members', undefined, { email, role });
}

export async function updateMemberRole(userId: string, role: UserRole): Promise<{ profile: MemberRow }> {
  return request('PATCH', '/admin-members', undefined, { user_id: userId, role });
}

export async function deleteMember(userId: string): Promise<{ profile: MemberRow }> {
  return request('DELETE', '/admin-members', { user_id: userId });
}

// -------- Gridge (R_10 룰 위버 편집기) --------

export interface GridgeRuleSummary {
  rule_id: string;
  version: string;
  created_at: string;
  last_actor: string | null;
  body_bytes: number;
}

export interface GridgeRuleDetail {
  rule_id: string;
  version: string;
  body_yaml: string;
  created_at: string;
  last_actor: string | null;
  notes: string | null;
  row_id: string;
}

export interface GridgeRulePublishResult {
  rule_id: string;
  version: string;
  previous_version: string | null;
  new_row_id: string;
  body_bytes: number;
}

export async function listGridgeRules(): Promise<{ rules: GridgeRuleSummary[] }> {
  return request('GET', '/gridge-rule-get');
}

export async function getGridgeRule(ruleId: string): Promise<GridgeRuleDetail> {
  return request('GET', '/gridge-rule-get', { rule_id: ruleId });
}

export async function publishGridgeRule(args: {
  rule_id: string;
  body_yaml: string;
  version?: string;
  notes?: string;
}): Promise<GridgeRulePublishResult> {
  return request('POST', '/gridge-rule-publish', undefined, args);
}

// -------- Gridge Builder (자연어 → AI → R_10 fragment) --------

export interface GridgeFragmentBuildResult {
  fragment_id: string;
  generated_yaml: string;
  model: string;
  rule_version: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
  };
}

export interface GridgeComposePreviewResult {
  rule_id: string;
  parent_version: string;
  parent_yaml: string;
  composed_yaml: string;
  fragments_used: Array<{ id: string; fragment_path: string; status: string }>;
  draft_included: boolean;
}

export interface GridgeComposePublishResult {
  rule_id: string;
  rule_version_id: string;
  version: string;
  previous_version: string | null;
  fragments_activated: string[];
  fragments_archived: string[];
  composed_bytes: number;
}

export async function buildGridgeFragment(args: {
  target_rule_id: string;
  target_path: string;
  nl_text: string;
  fragment_id?: string;
}): Promise<GridgeFragmentBuildResult> {
  return request('POST', '/gridge-fragment-build', undefined, args);
}

export async function previewGridgeCompose(args: {
  rule_id: string;
  draft_fragment_id?: string;
}): Promise<GridgeComposePreviewResult> {
  return request('GET', '/gridge-rule-compose-preview', {
    rule_id: args.rule_id,
    ...(args.draft_fragment_id ? { draft_fragment_id: args.draft_fragment_id } : {}),
  });
}

export async function publishGridgeCompose(args: {
  rule_id: string;
  draft_fragment_ids: string[];
  version: string;
  notes?: string;
}): Promise<GridgeComposePublishResult> {
  return request('POST', '/gridge-rule-compose-publish', undefined, args);
}
