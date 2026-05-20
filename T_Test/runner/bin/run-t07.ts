#!/usr/bin/env -S node --import=tsx
/**
 * T_07 우회 시나리오 — H_외부컨트롤 / H_하네스2 검증.
 *
 * 본 runner는 PRD-04 § 6의 5 시나리오 중 **T_07.02 외부 컨트롤 사이클**을 자동화.
 *   T_07.01 호스팅 전환 — Fly.io fallback 인프라 배포 후 별도 runner
 *   T_07.02 외부 컨트롤 — 본 파일 (LLM 비활성으로도 mechanics 측정 가능)
 *   T_07.03 multi-image — LLM 비용 의존, 별도 runner
 *   T_07.04·.05 — 문서 (T_07_docs/)
 *
 * T_07.02 측정 (LLM 없이도 가능한 mechanics):
 *   1. baseline — R_10.06 active 룰 (version_before) 기록
 *   2. cluster 준비 — 테스트용 sensor capture 1건 송출 → cluster_id 획득
 *   3. publish_rule RPC — 동일 본문, 새 version 발급 (rotate)
 *      → rule_versions: 이전 active → archived, 새 active 추가
 *      → rule_audit: action='publish' 1건 INSERT
 *   4. retrigger — enqueue_normalize_priority RPC → normalize_queue에 high priority row
 *   5. assertions — H_외부컨트롤·H_하네스2 사이클이 실 작동
 *   6. rollback (cleanup) — 원래 version으로 publish 복원
 *
 * 의도적으로 LLM normalize·실 정확도 측정은 제외 — 본 runner는 "사이클 메커니즘"만.
 * 정확도 변화는 T_04 --llm + 운영 normalized_field_edits 집계로 별도 측정.
 *
 * Usage:
 *   npm run t07 -w @hd/t-test
 */

import { CONFIG } from '../lib/config.js';
import { fail, finishRun, pass, skip, startRun } from '../lib/assert.js';
import { makeSensorFixture } from '../lib/fixtures.js';
import {
  cleanupSensorFixture,
  provisionTestKey,
  revokeKey,
  sendAllChunks,
  sendFinalize,
} from '../lib/sensor-helpers.js';
import { db } from '../lib/db.js';
import { randomUUID } from 'node:crypto';

const TARGET_RULE = 'R_10.06_PromptTemplates';
const T07_ACTOR = 'T_07.02_runner';

interface ActiveRuleRow {
  id: string;
  version: string;
  body_yaml: string;
  status: string;
  created_at: string;
}

async function fetchActive(): Promise<ActiveRuleRow | null> {
  const { data, error } = await db()
    .from('rule_versions')
    .select('id, version, body_yaml, status, created_at')
    .eq('rule_id', TARGET_RULE)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`fetch active failed: ${error.message}`);
  return (data ?? null) as ActiveRuleRow | null;
}

/**
 * Self-heal — 이전 T_07 run이 cleanup 못 끝내고 죽어 모든 row가 archived가 된 경우,
 * 가장 최근에 archived된 row를 active로 복원하고 그것을 baseline으로 채택.
 * (test 자가 복구 — 운영 영역과 분리)
 */
async function fetchActiveWithSelfHeal(): Promise<ActiveRuleRow | null> {
  const active = await fetchActive();
  if (active) return active;
  const { data: candidates, error } = await db()
    .from('rule_versions')
    .select('id, version, body_yaml, status, created_at, archived_at')
    .eq('rule_id', TARGET_RULE)
    .eq('status', 'archived')
    .not('version', 'like', 't07.%')
    .order('archived_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`self-heal fetch failed: ${error.message}`);
  const target = candidates?.[0];
  if (!target) return null;
  const { error: updErr } = await db()
    .from('rule_versions')
    .update({ status: 'active', archived_at: null })
    .eq('id', target.id);
  if (updErr) throw new Error(`self-heal restore failed: ${updErr.message}`);
  console.warn(`[T_07 self-heal] restored archived row ${target.id} (${target.version}) → active`);
  return target as ActiveRuleRow;
}

async function countRuleAudits(): Promise<number> {
  const { count, error } = await db()
    .from('rule_audit')
    .select('*', { count: 'exact', head: true })
    .eq('rule_id', TARGET_RULE);
  if (error) throw new Error(`count rule_audit failed: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const run = await startRun({
    suite: 'T_07', scenario: 'external_control_cycle',
    notes: 'T_07.02 — publish_rule + enqueue_normalize_priority mechanics (LLM 비활성)',
  });

  // ----- 0) Baseline 기록 (self-heal 포함) ------------------------------
  let baseline: ActiveRuleRow | null;
  try {
    baseline = await fetchActiveWithSelfHeal();
  } catch (e) {
    await fail(run, { step: 'baseline', name: 'rule_versions fetch', error: (e as Error).message });
    await finishRun(run); process.exit(1);
  }
  if (!baseline) {
    await fail(run, {
      step: 'baseline', name: `${TARGET_RULE} active row exists`,
      hypothesis: 'H_하네스2',
      actual: null,
      error: 'active row 없음 + archived 후보도 없음 — DB 시드 자체 누락',
    });
    await finishRun(run); process.exit(1);
  }
  await pass(run, {
    step: 'baseline', name: `${TARGET_RULE} active row exists`,
    hypothesis: 'H_하네스2',
    actual: { version: baseline.version, id: baseline.id },
  });

  const auditCountBefore = await countRuleAudits();

  // ----- 1) Cluster 준비 (LLM 비활성 — finalize까지만) -------------------
  const dealerId = `t07_${run.id.slice(0, 6)}`;
  const entityId = String(800000 + Math.floor(Math.random() * 99999));
  const fixture = makeSensorFixture({ dealerId, entityId });

  let key: Awaited<ReturnType<typeof provisionTestKey>> | undefined;
  let clusterId: string | undefined;

  try {
    key = await provisionTestKey();
    await pass(run, { step: 'provision', name: 'sensor_api_keys INSERT' });

    // ----- 1) Cluster setup ----------------------------------------------
    try {
      const ch = await sendAllChunks(key, fixture);
      const fin = await sendFinalize(key, fixture, ch.totalChunks, ch.fullHashHex);
      if (fin.status !== 200) {
        await fail(run, { step: 'cluster_setup', name: 'capture finalize', hypothesis: 'H1', actual: fin });
      } else {
        await pass(run, { step: 'cluster_setup', name: 'capture finalize 200', hypothesis: 'H1', durationMs: fin.durationMs });
      }
      const { data: c } = await db()
        .from('entity_clusters')
        .select('id')
        .eq('entity_id', entityId).eq('crm_id', 'bitrix24')
        .maybeSingle();
      clusterId = c?.id as string | undefined;
      if (clusterId) {
        await pass(run, { step: 'cluster_setup', name: 'entity_clusters row exists', hypothesis: 'H3', actual: { cluster_id: clusterId } });
      } else {
        await fail(run, { step: 'cluster_setup', name: 'entity_clusters row exists', hypothesis: 'H3', actual: null });
      }
    } catch (e) {
      await fail(run, { step: 'cluster_setup', name: 'cluster preparation', error: (e as Error).message });
    }

    // ----- 2) publish_rule (rotate version) -----------------------------
    const newVersion = `t07.${Date.now()}.${randomUUID().slice(0, 4)}`;
    let newRowId: string | null = null;
    try {
      const { data, error } = await db().rpc('publish_rule', {
        p_rule_id:   TARGET_RULE,
        p_version:   newVersion,
        p_body_yaml: baseline.body_yaml,
        p_body_json: null,
        p_actor:     T07_ACTOR,
        p_notes:     `T_07.02 mechanics test (run_id=${run.id})`,
      });
      if (error) throw new Error(error.message);
      newRowId = data as string;
      await pass(run, {
        step: 'publish_rule', name: 'publish_rule RPC',
        hypothesis: 'H_외부컨트롤',
        actual: { new_version: newVersion, new_row_id: newRowId },
      });
    } catch (e) {
      await fail(run, {
        step: 'publish_rule', name: 'publish_rule RPC',
        hypothesis: 'H_외부컨트롤', error: (e as Error).message,
      });
    }

    // ----- 3) Verify rotation -------------------------------------------
    let postActive: ActiveRuleRow | null = null;
    try {
      postActive = await fetchActive();
      if (postActive?.version === newVersion && postActive.id !== baseline.id) {
        await pass(run, {
          step: 'rotation', name: 'new active row != baseline',
          hypothesis: 'H_외부컨트롤',
          expected: newVersion, actual: postActive?.version,
        });
      } else {
        await fail(run, {
          step: 'rotation', name: 'new active row != baseline',
          hypothesis: 'H_외부컨트롤',
          expected: newVersion, actual: postActive?.version ?? null,
        });
      }
    } catch (e) {
      await fail(run, { step: 'rotation', name: 'fetch new active', error: (e as Error).message });
    }

    // baseline row archived?
    try {
      const { data: prev } = await db()
        .from('rule_versions')
        .select('status, archived_at')
        .eq('id', baseline.id)
        .maybeSingle();
      if (prev?.status === 'archived' && prev.archived_at) {
        await pass(run, {
          step: 'rotation', name: 'baseline row → archived',
          hypothesis: 'H_외부컨트롤',
          actual: { status: prev.status, archived_at: prev.archived_at },
        });
      } else {
        await fail(run, {
          step: 'rotation', name: 'baseline row → archived',
          hypothesis: 'H_외부컨트롤',
          actual: prev,
        });
      }
    } catch (e) {
      await fail(run, { step: 'rotation', name: 'check baseline archived', error: (e as Error).message });
    }

    // rule_audit 1행 INSERT?
    try {
      const auditCountAfter = await countRuleAudits();
      if (auditCountAfter === auditCountBefore + 1) {
        await pass(run, {
          step: 'rotation', name: 'rule_audit row 1건 추가',
          hypothesis: 'H_하네스2',
          actual: { before: auditCountBefore, after: auditCountAfter },
          metric: { name: 'audit_delta', value: 1 },
        });
      } else {
        await fail(run, {
          step: 'rotation', name: 'rule_audit row 1건 추가',
          hypothesis: 'H_하네스2',
          actual: { before: auditCountBefore, after: auditCountAfter },
        });
      }
    } catch (e) {
      await fail(run, { step: 'rotation', name: 'rule_audit count', error: (e as Error).message });
    }

    // ----- 4) Retrigger via enqueue_normalize_priority ------------------
    if (clusterId) {
      try {
        const { data, error } = await db().rpc('enqueue_normalize_priority', {
          p_cluster_id: clusterId,
          p_priority:   'high',
          p_actor:      T07_ACTOR,
          p_reason:     `T_07.02 retrigger after publish_rule ${newVersion}`,
        });
        if (error) throw new Error(error.message);
        const queueId = data as string;

        const { data: queueRow } = await db()
          .from('normalize_queue')
          .select('id, status, priority, attempts')
          .eq('id', queueId)
          .maybeSingle();
        if (queueRow && queueRow.priority === 'high') {
          await pass(run, {
            step: 'retrigger', name: 'normalize_queue row 추가 (priority=high)',
            hypothesis: 'H_외부컨트롤',
            actual: queueRow,
          });
        } else {
          await fail(run, {
            step: 'retrigger', name: 'normalize_queue row 추가',
            hypothesis: 'H_외부컨트롤',
            actual: queueRow,
          });
        }
      } catch (e) {
        await fail(run, {
          step: 'retrigger', name: 'enqueue_normalize_priority RPC',
          hypothesis: 'H_외부컨트롤', error: (e as Error).message,
        });
      }
    } else {
      await skip(run, {
        step: 'retrigger', name: 'enqueue_normalize_priority (cluster 미생성)',
        hypothesis: 'H_외부컨트롤',
      });
    }
  } catch (outer) {
    // step1~4 도중 unexpected throw — fail로 기록만 하고 cleanup은 finally에서 보장.
    await fail(run, { step: 'unexpected', name: 'main flow exception', error: (outer as Error).message });
  } finally {
    // ----- 5) Cleanup — 항상 실행 (성공/실패/throw 무관) -------------------
    if (CONFIG.cleanup) {
      // (a) rule_versions cleanup — DB 영역
      try {
        const { error: delErr } = await db()
          .from('rule_versions')
          .delete()
          .eq('rule_id', TARGET_RULE)
          .like('version', 't07.%');
        if (delErr) {
          await fail(run, { step: 'cleanup', name: 'delete t07.* rule_versions', error: delErr.message });
        } else {
          await pass(run, { step: 'cleanup', name: 'delete t07.* rule_versions' });
        }

        const { error: restoreErr } = await db()
          .from('rule_versions')
          .update({ status: 'active', archived_at: null })
          .eq('id', baseline.id);
        if (restoreErr) {
          await fail(run, { step: 'cleanup', name: 'restore baseline → active', error: restoreErr.message });
        } else {
          await pass(run, { step: 'cleanup', name: 'restore baseline → active' });
        }
      } catch (e) {
        // cleanup 실패는 다음 run 의 self-heal이 받아냄. fail 기록만.
        await fail(run, { step: 'cleanup', name: 'rule_versions cleanup exception', error: (e as Error).message });
      }

      // (b) sensor fixture cleanup — Storage/HMAC 영역 (best-effort)
      try {
        if (clusterId) await cleanupSensorFixture(fixture, clusterId);
        else await cleanupSensorFixture(fixture);
        if (key) await revokeKey(key.keyId);
      } catch (e) {
        await fail(run, { step: 'cleanup', name: 'sensor fixture cleanup', error: (e as Error).message });
      }
    }
  }

  const result = await finishRun(run);
  process.exit(result.status === 'passed' ? 0 : 1);
}

await main().catch((e) => {
  if (e && (e as { __t_test_silent?: boolean }).__t_test_silent) throw e;
  console.error('FATAL', e);
  process.exit(2);
});
