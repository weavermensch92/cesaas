// shared/lead_scoring.ts — Lead scoring helper (Phase D.3 + F).
// SQL trigger의 score_lead/generate_dealer_output을 대체.
//
// 흐름:
//   1. R_10.01·.02·.05·.07 룰 로드 (DB rule_versions.active)
//   2. lead + 최신 voice response + (선택) normalized_fields fetch
//   3. EvaluationContext 빌드 → *Core 적용 (applyLeadScoring·applyLeadQuality·classifyLeadPriority)
//   4. UPDATE leads { score, grade, priority, score_at, score_version }
//   5. dealer_outputs supersede + 새 active INSERT
//      Phase F (V-009): R_10.07 playbook을 lookup해 title·weapons·pitch·models·next_action 채움.
//      R_10.07 로드 실패 시 title만으로 fallback (기존 동작 유지).
//
// 호출:
//   - V_Voice/backend/functions/responses-receive: save_response 후
//   - S_Sensor/backend/functions/normalize-worker: save_normalized_with_supersede 후
//
// 안전성: 룰 로드·DB 실패해도 throw 안 함. 호출부 메인 흐름을 끊지 않음.

import { db } from './db.ts';
import { loadRule } from './rules.ts';
import { log } from './logger.ts';
import {
  applyLeadQualityCore,
  applyLeadScoringCore,
  classifyLeadPriorityCore,
} from 'harness2/apply_rules.ts';
import type {
  ClassificationYaml,
  EvaluationContext,
  LeadQualityYaml,
  LeadScoringYaml,
  PlaybookEntry,
  Segment,
} from 'harness2/types.ts';
import {
  DW_AXES,
  type AxisWeights,
  type DWAxis,
  dotAxes,
  normalizePreferenceAxes,
} from '@hd/core/decision_weight';

export interface ScoreLeadResult {
  ok: boolean;
  lead_id: string;
  score?: number;
  grade?: 'A' | 'B' | 'C' | 'D';
  priority?: string;
  score_version?: string;
  reason?: string;          // ok=false일 때
}

export async function scoreLead(leadId: string): Promise<ScoreLeadResult> {
  // ---- 1. 룰 3종 로드 ---------------------------------------------------
  let scoringYaml: { body: LeadScoringYaml; version: string };
  let qualityYaml: { body: LeadQualityYaml; version: string };
  let classYaml:   { body: ClassificationYaml; version: string };
  try {
    [scoringYaml, qualityYaml, classYaml] = await Promise.all([
      loadRule<LeadScoringYaml>('R_10.01_LeadScoring'),
      loadRule<LeadQualityYaml>('R_10.02_LeadQuality'),
      loadRule<ClassificationYaml>('R_10.05_Classification'),
    ]);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log('warn', 'scoreLead: rule load failed — skip scoring', { lead_id: leadId, reason });
    return { ok: false, lead_id: leadId, reason: `rule_load_failed: ${reason}` };
  }

  // ---- 2. lead + 최신 response ---------------------------------------
  const { data: lead, error: leadErr } = await db()
    .from('leads')
    .select('id, entity_id, crm_id, segment, sensor_count, amount, currency')
    .eq('id', leadId)
    .maybeSingle();
  if (leadErr) {
    log('error', 'scoreLead: lead fetch failed', { lead_id: leadId, db: leadErr.message });
    return { ok: false, lead_id: leadId, reason: 'lead_fetch_failed' };
  }
  if (!lead) {
    log('warn', 'scoreLead: lead not found', { lead_id: leadId });
    return { ok: false, lead_id: leadId, reason: 'lead_not_found' };
  }

  const { data: latestResponse } = await db()
    .from('responses')
    .select('nps, future_subscription, axis_data, preference_axes')
    .eq('lead_id', leadId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ---- 3. EvaluationContext --------------------------------------------
  // deal_amount_rub: lead.amount (currency RUB 또는 null 일 때만)
  const dealAmountRub: number | undefined =
    (lead.currency === 'RUB' || lead.currency == null) && typeof lead.amount === 'number'
      ? lead.amount
      : undefined;

  const ctx: EvaluationContext = {
    lead: {
      segment: (lead.segment as Segment | null) ?? undefined,
      sensor_activity_count: lead.sensor_count ?? 0,
      ...(dealAmountRub !== undefined ? { deal_amount_rub: dealAmountRub } : {}),
    },
    ...(latestResponse ? {
      response: {
        ...(latestResponse.nps != null ? { nps: latestResponse.nps as number } : {}),
        ...(latestResponse.future_subscription != null
          ? { future_subscription: latestResponse.future_subscription as boolean }
          : {}),
      },
    } : {}),
  };

  // ---- 4. *Core 적용 + R_10.01.005 dw_alignment_bonus ------------------
  // R_10.01.005는 evaluator로 처리 불가(멀티라인 action·dot()/clip() 함수).
  // applyLeadScoringCore가 R_10.01.005 condition을 false로 우회한 뒤 별도 산출 → score 가산.
  // preference_axes(1~5) → (v-1)/4 정규화 → hd_strength_matrix[segment] 내적(0~6) → round*2.5 clip [0,15].
  let score: number;
  let grade: 'A' | 'B' | 'C' | 'D';
  let priority: string;
  let dwAlignment: number | null = null;
  let dwBonus = 0;
  try {
    const scoringResult = applyLeadScoringCore(scoringYaml.body, ctx);
    score = scoringResult.score;

    const dw = computeDwAlignmentBonus(scoringYaml.body, latestResponse?.preference_axes, lead.segment);
    if (dw) {
      dwAlignment = dw.alignment;
      dwBonus = dw.bonus;
      score = Math.max(
        scoringYaml.body.output.clamp_min,
        Math.min(scoringYaml.body.output.clamp_max, score + dwBonus),
      );
    }

    grade = applyLeadQualityCore(qualityYaml.body, score);
    priority = classifyLeadPriorityCore(classYaml.body, score);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log('error', 'scoreLead: apply failed', { lead_id: leadId, reason });
    return { ok: false, lead_id: leadId, reason: `apply_failed: ${reason}` };
  }

  const scoreVersion =
    `r10.01@${scoringYaml.version}|r10.02@${qualityYaml.version}|r10.05@${classYaml.version}`;

  // ---- 5. UPDATE leads --------------------------------------------------
  const leadUpdate: Record<string, unknown> = {
    score,
    grade,
    priority,
    score_at: new Date().toISOString(),
    score_version: scoreVersion,
  };
  if (dwAlignment != null) leadUpdate.dw_alignment = dwAlignment;
  const { error: updErr } = await db()
    .from('leads')
    .update(leadUpdate)
    .eq('id', leadId);
  if (updErr) {
    log('error', 'scoreLead: leads UPDATE failed', { lead_id: leadId, db: updErr.message });
    return { ok: false, lead_id: leadId, reason: 'leads_update_failed' };
  }

  // ---- 6. dealer_outputs supersede + INSERT (V-009 Phase F) -----------
  // R_10.07 로드 후 segment lookup → talking_points·pitch_examples·next_action 풀 payload.
  // 로드 실패 시 title fallback (이전 v1 동작 보존).
  if (lead.segment) {
    let title = `Playbook · ${lead.segment} · ${priority}`;
    let weapons: Record<string, unknown> | null = null;
    let pitch:   Record<string, unknown> | null = null;
    let models:  string[] | null = null;
    let nextAction: Record<string, unknown> | null = null;
    let r10_07_version: string | null = null;

    try {
      const r10_07 = await loadRule<Record<string, unknown>>('R_10.07_DealerOutput');
      const pb = (r10_07.body?.playbook as Record<string, PlaybookEntry> | undefined)?.[lead.segment];
      if (pb) {
        title = pb.title_ko ?? pb.title_ru ?? title;
        weapons = {
          ko: pb.talking_points_ko ?? [],
          ru: pb.talking_points_ru ?? [],
          items: pb.sales_weapons ?? [],
        };
        pitch = {
          ko: pb.pitch_examples_ko ?? [],
          ru: pb.pitch_examples_ru ?? [],
        };
        models = pb.related_models ?? [];
        nextAction = pb.next_action_template
          ? { ko: pb.next_action_template, ru: pb.next_action_template }
          : null;
      }
      r10_07_version = r10_07.version;
    } catch (e) {
      log('warn', 'scoreLead: R_10.07 load failed (title-only fallback)', {
        lead_id: leadId,
        reason: e instanceof Error ? e.message : String(e),
      });
    }

    await db()
      .from('dealer_outputs')
      .update({ status: 'superseded' })
      .eq('lead_id', leadId)
      .eq('status', 'active');

    const ruleVersion = r10_07_version
      ? `${scoreVersion}|r10.07@${r10_07_version}`
      : scoreVersion;

    const { error: insErr } = await db()
      .from('dealer_outputs')
      .insert({
        lead_id: leadId,
        segment: lead.segment,
        priority,
        score_snapshot: score,
        title,
        weapons,
        pitch,
        models,
        next_action: nextAction,
        source: 'rule',
        rule_version: ruleVersion,
      });
    if (insErr) {
      // dealer_output INSERT 실패는 scoring 자체는 성공 — warn 로깅만.
      log('warn', 'scoreLead: dealer_output INSERT failed', {
        lead_id: leadId, db: insErr.message,
      });
    }
  }

  log('info', 'scoreLead done', {
    lead_id: leadId, score, grade, priority,
    ...(dwAlignment != null ? { dw_alignment: dwAlignment, dw_bonus: dwBonus } : {}),
  });
  return { ok: true, lead_id: leadId, score, grade, priority, score_version: scoreVersion };
}

// R_10.01.005 dw_alignment_bonus — preference_axes(1~5) × hd_strength_matrix[segment] 내적.
// hd_strength_matrix 또는 segment·preference_axes 미존재 시 null 반환 (score 영향 0).
function computeDwAlignmentBonus(
  scoringRule: LeadScoringYaml,
  preferenceAxes: unknown,
  segment: Segment | null | undefined,
): { alignment: number; bonus: number } | null {
  if (!segment || !preferenceAxes || typeof preferenceAxes !== 'object') return null;

  const matrix = (scoringRule as unknown as {
    hd_strength_matrix?: Record<string, Partial<Record<DWAxis, number>>>;
  }).hd_strength_matrix;
  if (!matrix) return null;

  const hdStrength = matrix[segment];
  if (!hdStrength) return null;

  const axesByName: Partial<Record<DWAxis, number>> = {};
  for (const axis of DW_AXES) {
    const v = (preferenceAxes as Record<string, unknown>)[axis];
    if (typeof v === 'number' && Number.isFinite(v)) axesByName[axis] = v;
  }
  if (Object.keys(axesByName).length === 0) return null;

  const normalized: AxisWeights = normalizePreferenceAxes(axesByName);
  const alignment = dotAxes(normalized, hdStrength);  // 0~6
  const bonus = Math.max(0, Math.min(15, Math.round(alignment * 2.5)));
  return { alignment, bonus };
}
