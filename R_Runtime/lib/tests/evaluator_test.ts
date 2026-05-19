// evaluator 단위 테스트. 실행: deno test R_Runtime/lib/tests/

import { assertEquals, assertThrows } from 'jsr:@std/assert@0.220';
import { applyAction, evaluateCondition } from '../evaluator.ts';

// ============================================================================
// § 1. 기본 비교
// ============================================================================

Deno.test('evaluator — 단순 숫자 비교', () => {
  assertEquals(evaluateCondition('response.nps >= 9', { response: { nps: 10 } }), true);
  assertEquals(evaluateCondition('response.nps >= 9', { response: { nps: 8 } }), false);
});

Deno.test('evaluator — 등호·부등호', () => {
  assertEquals(evaluateCondition('score == 100', { score: 100 }), true);
  assertEquals(evaluateCondition('score == 100', { score: 99 }), false);
  assertEquals(evaluateCondition('score != 100', { score: 99 }), true);
});

Deno.test('evaluator — boolean 비교', () => {
  assertEquals(
    evaluateCondition(
      'response.future_subscription == true',
      { response: { future_subscription: true } },
    ),
    true,
  );
});

// ============================================================================
// § 2. AND / OR / NOT / 괄호
// ============================================================================

Deno.test('evaluator — AND', () => {
  const ctx = { lead: { sensor_activity_count: 7, segment: 'mining' as const } };
  assertEquals(
    evaluateCondition(
      "lead.segment == 'mining' AND lead.sensor_activity_count >= 5",
      ctx,
    ),
    true,
  );
  assertEquals(
    evaluateCondition(
      "lead.segment == 'mining' AND lead.sensor_activity_count >= 10",
      ctx,
    ),
    false,
  );
});

Deno.test('evaluator — OR', () => {
  assertEquals(evaluateCondition('score >= 80 OR score >= 50', { score: 60 }), true);
  assertEquals(evaluateCondition('score >= 80 OR score >= 90', { score: 60 }), false);
});

Deno.test('evaluator — AND/OR 혼합 (좌→우)', () => {
  assertEquals(evaluateCondition('score >= 50 AND score < 80', { score: 60 }), true);
  assertEquals(evaluateCondition('score >= 50 AND score < 80', { score: 85 }), false);
});

Deno.test('evaluator — NOT', () => {
  assertEquals(evaluateCondition('NOT score >= 80', { score: 60 }), true);
  assertEquals(evaluateCondition('NOT score >= 80', { score: 90 }), false);
});

// ============================================================================
// § 3. in 연산자
// ============================================================================

Deno.test('evaluator — in 배열', () => {
  const ctx = { lead: { segment: 'mining' as const } };
  assertEquals(
    evaluateCondition("lead.segment in ['mining', 'key_account']", ctx),
    true,
  );
  assertEquals(
    evaluateCondition("lead.segment in ['agriculture', 'forestry']", ctx),
    false,
  );
});

// ============================================================================
// § 4. R_10.01 실 룰 시나리오
// ============================================================================

Deno.test('R_10.01.001 NPS 높음', () => {
  assertEquals(evaluateCondition('response.nps >= 9', { response: { nps: 9 } }), true);
});

Deno.test('R_10.01.002 고가치 segment + 활동', () => {
  const ctx = { lead: { segment: 'mining' as const, sensor_activity_count: 7 } };
  assertEquals(
    evaluateCondition(
      "lead.segment in ['mining', 'key_account'] AND lead.sensor_activity_count >= 5",
      ctx,
    ),
    true,
  );
});

Deno.test('R_10.01.004 거래액 임계', () => {
  assertEquals(
    evaluateCondition('lead.deal_amount_rub >= 5000000', { lead: { deal_amount_rub: 8_000_000 } }),
    true,
  );
  assertEquals(
    evaluateCondition('lead.deal_amount_rub >= 5000000', { lead: { deal_amount_rub: 3_000_000 } }),
    false,
  );
});

// ============================================================================
// § 5. default · null/undefined 안전성
// ============================================================================

Deno.test('default fallback', () => {
  assertEquals(evaluateCondition('default', {}), true);
  assertEquals(evaluateCondition('true', {}), true);
  assertEquals(evaluateCondition('false', {}), false);
});

Deno.test('null·undefined 비교는 false', () => {
  assertEquals(evaluateCondition('response.nps >= 9', { response: {} }), false);
  assertEquals(evaluateCondition('response.nps >= 9', {}), false);
});

// ============================================================================
// § 6. applyAction
// ============================================================================

Deno.test('applyAction — score += 30', () => {
  const state = applyAction('score += 30', { score: 50 });
  assertEquals(state.score, 80);
});

Deno.test('applyAction — score = 100 직접 할당', () => {
  const state = applyAction('score = 100', { score: 50 });
  assertEquals(state.score, 100);
});

Deno.test('applyAction — 누락 변수는 0부터', () => {
  const state = applyAction('score += 30', {});
  assertEquals(state.score, 30);
});

// ============================================================================
// § 7. 잘못된 표현식
// ============================================================================

Deno.test('evaluator — 잘못된 표현식은 throw', () => {
  assertThrows(() => evaluateCondition('@@@ invalid @@@', {}));
});
