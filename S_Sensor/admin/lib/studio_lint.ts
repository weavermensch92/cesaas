/**
 * Studio Lint (client) — 서버 [studio_lint.ts](../../V_Voice/backend/shared/studio_lint.ts)의
 * 클라이언트 대응판. spec mutate 시 즉시 재계산해 UI에 표시.
 *
 * 클라이언트는 비용·UX 이유로 `merge_candidate` 만 제외 — 나머지 4종은 동일 임계값.
 * 임계값/축 커버리지를 서버와 sync 하려면 양쪽 상단 상수를 함께 수정.
 *
 * 타입은 @/lib/api 의 Studio* 시리즈를 그대로 사용 — 중복 정의 제거.
 */

import type { StudioLintWarning, StudioQuestion, StudioSurveySpec, StudioTarget } from './api';

export type TargetAudience = StudioTarget;
export type LintWarning = StudioLintWarning;

// ─── 임계값 (서버와 동일) ────────────────────────────────────────────────────

export const SECS_PER_TYPE: Record<string, number> = {
  single_select: 8,
  multi_select: 12,
  scale_1_5: 6,
  scale_1_10: 7,
  nps: 10,
  text_short: 20,
  text_long: 45,
  number: 10,
  slider: 10,
  consent: 4,
};
export const TIME_OVERRUN_MULTIPLIER = 1.1;
export const DEFAULT_TARGET_MINUTES = { dealer: 6, visitor: 2 } as const;
export const REQUIRED_AXES: Record<TargetAudience, string[]> = {
  dealer: ['scale', 'usage', 'annual_operating_hours', 'annual_deal_rub', 'fleet_size', 'decision_role'],
  visitor: ['scale', 'usage', 'fleet_size', 'decision_role'],
};
export const OPTION_MIN = 2;
export const OPTION_MAX = 7;

// ─── 메인 ───────────────────────────────────────────────────────────────────

export function lintSurveySpecClient(spec: StudioSurveySpec, target: TargetAudience): LintWarning[] {
  const out: LintWarning[] = [];
  const qs = Array.isArray(spec.questions) ? spec.questions : [];

  out.push(...checkTimeOverrun(spec, qs, target));
  out.push(...checkMissingRequired(qs, target));
  out.push(...checkLanguageGap(spec, qs));
  out.push(...checkOptionImbalance(qs));

  return out;
}

/** 서버+클라 warnings를 코드별 dedupe (서버 결과 우선). */
export function mergeWarnings(server: LintWarning[], client: LintWarning[]): LintWarning[] {
  const seen = new Set(server.map((w) => `${w.code}:${w.question_ids.join(',')}`));
  const extras = client.filter((w) => !seen.has(`${w.code}:${w.question_ids.join(',')}`));
  return [...server, ...extras];
}

// ─── 개별 체크 ───────────────────────────────────────────────────────────────

function checkTimeOverrun(
  spec: StudioSurveySpec,
  qs: StudioQuestion[],
  target: TargetAudience,
): LintWarning[] {
  const totalSecs = qs.reduce((acc, q) => acc + (SECS_PER_TYPE[q.type] ?? 10), 0);
  const targetMin = spec.estimated_minutes ?? DEFAULT_TARGET_MINUTES[target];
  const allowedSecs = targetMin * 60 * TIME_OVERRUN_MULTIPLIER;
  if (totalSecs <= allowedSecs) return [];
  return [{
    code: 'time_overrun',
    severity: 'warn',
    question_ids: qs.map((q) => q.id ?? '').filter(Boolean),
    message_ko: `예상 소요 ${(totalSecs / 60).toFixed(1)}분 > 목표 ${targetMin}분 × 110%. 문항 수를 줄이거나 estimated_minutes를 늘리세요.`,
    suggestion_patch: { estimated_minutes: Math.ceil(totalSecs / 60) },
  }];
}

function checkMissingRequired(qs: StudioQuestion[], target: TargetAudience): LintWarning[] {
  const out: LintWarning[] = [];

  if (!qs.some((q) => q.type === 'nps')) {
    out.push({
      code: 'missing_required',
      severity: 'error',
      question_ids: [],
      message_ko: 'NPS(0~10) 문항이 누락되었습니다. R_10.08 기준 필수.',
    });
  }
  if (!qs.some((q) => q.type === 'consent')) {
    out.push({
      code: 'missing_required',
      severity: 'error',
      question_ids: [],
      message_ko: 'consent(data_collection) 문항이 누락되었습니다. PII 동의 필수.',
    });
  }

  const required = REQUIRED_AXES[target];
  const present = new Set(qs.map((q) => (typeof q.axis === 'string' ? q.axis : '')).filter(Boolean));
  const missing = required.filter((a) => !present.has(a));
  if (missing.length > 0) {
    out.push({
      code: 'missing_required',
      severity: 'warn',
      question_ids: [],
      message_ko: `${target} 필수 축 누락: ${missing.join(', ')}. R_10.05 segment 매칭 정확도 저하.`,
    });
  }
  return out;
}

function checkLanguageGap(spec: StudioSurveySpec, qs: StudioQuestion[]): LintWarning[] {
  const out: LintWarning[] = [];
  const lang = spec.language_default ?? 'ru';
  const field: keyof StudioQuestion = lang === 'ko' ? 'title_ko' : lang === 'en' ? 'title_en' : 'title_ru';

  const missingDefault = qs
    .filter((q) => !str(q[field] as unknown))
    .map((q) => q.id ?? '')
    .filter(Boolean);
  if (missingDefault.length > 0) {
    out.push({
      code: 'language_gap',
      severity: 'warn',
      question_ids: missingDefault,
      message_ko: `language_default=${lang}이지만 ${field}가 비어있는 질문 ${missingDefault.length}건.`,
    });
  }

  if (lang !== 'ru') {
    const missingRu = qs.filter((q) => !str(q.title_ru)).map((q) => q.id ?? '').filter(Boolean);
    if (missingRu.length > 0) {
      out.push({
        code: 'language_gap',
        severity: 'warn',
        question_ids: missingRu,
        message_ko: `title_ru 누락 ${missingRu.length}건. 러시아 부스 표준이므로 채워야 합니다.`,
      });
    }
  }
  return out;
}

function checkOptionImbalance(qs: StudioQuestion[]): LintWarning[] {
  const out: LintWarning[] = [];
  for (const q of qs) {
    if (q.type !== 'single_select') continue;
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < OPTION_MIN) {
      out.push({
        code: 'option_imbalance',
        severity: 'warn',
        question_ids: [q.id ?? ''].filter(Boolean),
        message_ko: `single_select 옵션이 ${opts.length}개. 최소 ${OPTION_MIN}개 필요.`,
      });
    } else if (opts.length > OPTION_MAX) {
      out.push({
        code: 'option_imbalance',
        severity: 'warn',
        question_ids: [q.id ?? ''].filter(Boolean),
        message_ko: `single_select 옵션이 ${opts.length}개. ${OPTION_MAX}개 이하 권장.`,
      });
    }
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
