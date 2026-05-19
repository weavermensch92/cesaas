// harness2/lib/evaluator.ts — YAML 조건 표현식 안전 평가.
// PRD-03 § 4 R-021.
//
// 표현식 예:
//   'response.nps >= 9'
//   'lead.segment in [\'mining\', \'key_account\'] AND lead.sensor_activity_count >= 5'
//   'score >= 80'
//
// 안전성: eval() 금지. 직접 파서로 처리.
// 지원: 비교(>= > <= < == !=) · 논리(AND OR NOT) · in · 괄호 · default

import type { EvaluationContext } from './types.ts';

// ============================================================================
// Public API
// ============================================================================

export function evaluateCondition(expression: string, context: EvaluationContext): boolean {
  const expr = expression.trim();
  if (expr === 'default' || expr === 'true') return true;
  if (expr === 'false') return false;
  return evalLogical(expr, context);
}

/**
 * action 표현식 적용 — 'score += 30' / 'score = 100'.
 * state를 직접 수정하고 반환.
 */
export function applyAction(
  action: string,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const act = action.trim();

  // compound: score += N
  const compoundMatch = act.match(/^(\w+)\s*([+\-*/])=\s*(-?\d+(?:\.\d+)?)$/);
  if (compoundMatch) {
    const [, varName, op, valStr] = compoundMatch;
    const val = parseFloat(valStr);
    const current = (state[varName] as number) ?? 0;
    switch (op) {
      case '+': state[varName] = current + val; break;
      case '-': state[varName] = current - val; break;
      case '*': state[varName] = current * val; break;
      case '/': state[varName] = current / val; break;
    }
    return state;
  }

  // assign: score = expr
  const assignMatch = act.match(/^(\w+)\s*=\s*(.+)$/);
  if (assignMatch) {
    const [, varName, valStr] = assignMatch;
    state[varName] = evalValue(valStr.trim(), state as EvaluationContext);
    return state;
  }

  throw new Error(`Cannot parse action: ${action}`);
}

// ============================================================================
// 논리 — OR(우선순위 낮음) → AND → 괄호 → NOT → 비교
// ============================================================================

function evalLogical(expr: string, ctx: EvaluationContext): boolean {
  const orParts = splitTopLevel(expr, [' OR ']);
  if (orParts.length > 1) return orParts.some((p) => evalLogical(p, ctx));

  const andParts = splitTopLevel(expr, [' AND ']);
  if (andParts.length > 1) return andParts.every((p) => evalLogical(p, ctx));

  if (expr.startsWith('(') && matchingParen(expr) === expr.length - 1) {
    return evalLogical(expr.slice(1, -1), ctx);
  }

  if (expr.toLowerCase().startsWith('not ')) return !evalLogical(expr.slice(4), ctx);

  return evalComparison(expr, ctx);
}

function splitTopLevel(expr: string, separators: string[]): string[] {
  const parts: string[] = [];
  let depth = 0;
  let i = 0;
  let lastSplit = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;

    if (depth === 0) {
      for (const sep of separators) {
        if (expr.slice(i, i + sep.length) === sep) {
          parts.push(expr.slice(lastSplit, i).trim());
          lastSplit = i + sep.length;
          i = lastSplit;
          break;
        }
      }
    }
    i++;
  }
  parts.push(expr.slice(lastSplit).trim());
  return parts.filter((p) => p.length > 0);
}

function matchingParen(expr: string): number {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ============================================================================
// 비교
// ============================================================================

const COMPARISON_OPS: { op: string; fn: (a: unknown, b: unknown) => boolean }[] = [
  { op: '>=', fn: (a, b) => (a as number) >= (b as number) },
  { op: '<=', fn: (a, b) => (a as number) <= (b as number) },
  { op: '==', fn: (a, b) => a === b },
  { op: '!=', fn: (a, b) => a !== b },
  { op: '>',  fn: (a, b) => (a as number) >  (b as number) },
  { op: '<',  fn: (a, b) => (a as number) <  (b as number) },
];

function evalComparison(expr: string, ctx: EvaluationContext): boolean {
  // " in " 처리
  const inMatch = expr.match(/^(.+?)\s+in\s+(.+)$/);
  if (inMatch) {
    const left = evalValue(inMatch[1].trim(), ctx);
    const right = evalValue(inMatch[2].trim(), ctx);
    return Array.isArray(right) ? right.includes(left) : false;
  }

  for (const { op, fn } of COMPARISON_OPS) {
    const idx = expr.indexOf(op);
    if (idx === -1) continue;

    const left = expr.slice(0, idx).trim();
    const right = expr.slice(idx + op.length).trim();
    if (left.length === 0 || right.length === 0) continue;

    const leftVal = evalValue(left, ctx);
    const rightVal = evalValue(right, ctx);

    if (leftVal === null || leftVal === undefined) return false;
    return fn(leftVal, rightVal);
  }

  // 단일 boolean / truthy
  return !!evalValue(expr, ctx);
}

// ============================================================================
// 값 평가 — 리터럴 · 필드 접근 · 배열
// ============================================================================

function evalValue(token: string, ctx: EvaluationContext): unknown {
  const t = token.trim();

  if (t === 'true')  return true;
  if (t === 'false') return false;
  if (t === 'null')  return null;

  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);

  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }

  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitTopLevel(inner, [', ', ',']).map((p) => evalValue(p, ctx));
  }

  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(t)) return getNestedField(ctx, t);

  throw new Error(`Cannot evaluate token: ${t}`);
}

function getNestedField(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
