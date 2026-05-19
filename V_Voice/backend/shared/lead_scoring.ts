// shared/lead_scoring.ts — Lead scoring helper (Phase D.3).
// SQL trigger의 score_lead/generate_dealer_output을 대체.
//
// 흐름:
//   1. R_10.01·.02·.05 룰 로드 (DB rule_versions.active)
//   2. lead + 최신 voice response + (선택) normalized_fields fetch
//   3. EvaluationContext 빌드 → *Core 적용 (applyLeadScoring·applyLeadQuality·classifyLeadPriority)
//   4. UPDATE leads { score, grade, priority, score_at, score_version }
//   5. dealer_outputs supersede + 새 active INSERT (R_10.07 텍스트 렌더는 Phase E)
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
  Segment,
} from 'harness2/types.ts';

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
    .select('nps, future_subscription, axis_data')
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

  // ---- 4. *Core 적용 ----------------------------------------------------
  let score: number;
  let grade: 'A' | 'B' | 'C' | 'D';
  let priority: string;
  try {
    const scoringResult = applyLeadScoringCore(scoringYaml.body, ctx);
    score = scoringResult.score;
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
  const { error: updErr } = await db()
    .from('leads')
    .update({
      score,
      grade,
      priority,
      score_at: new Date().toISOString(),
      score_version: scoreVersion,
    })
    .eq('id', leadId);
  if (updErr) {
    log('error', 'scoreLead: leads UPDATE failed', { lead_id: leadId, db: updErr.message });
    return { ok: false, lead_id: leadId, reason: 'leads_update_failed' };
  }

  // ---- 6. dealer_outputs supersede + INSERT ----------------------------
  // R_10.07 텍스트 렌더는 Phase E. v1은 segment + priority + score만 기록.
  if (lead.segment) {
    await db()
      .from('dealer_outputs')
      .update({ status: 'superseded' })
      .eq('lead_id', leadId)
      .eq('status', 'active');

    const { error: insErr } = await db()
      .from('dealer_outputs')
      .insert({
        lead_id: leadId,
        segment: lead.segment,
        priority,
        score_snapshot: score,
        title: `Playbook · ${lead.segment} · ${priority}`,
        source: 'rule',
        rule_version: scoreVersion,
      });
    if (insErr) {
      // dealer_output INSERT 실패는 scoring 자체는 성공 — warn 로깅만.
      log('warn', 'scoreLead: dealer_output INSERT failed', {
        lead_id: leadId, db: insErr.message,
      });
    }
  }

  log('info', 'scoreLead done', { lead_id: leadId, score, grade, priority });
  return { ok: true, lead_id: leadId, score, grade, priority, score_version: scoreVersion };
}
