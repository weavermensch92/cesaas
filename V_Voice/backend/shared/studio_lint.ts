/**
 * Studio Lint — Studio v2 검토 단계 결정론적 검증.
 *
 * 5종 체크:
 *   - time_overrun     : Σ secPerType(q.type) > estimated_minutes × 60 × 1.1
 *   - missing_required : NPS 누락 · consent 누락 · axis 커버리지 부족
 *   - language_gap     : title_<language_default> 누락 또는 title_ru 누락
 *   - merge_candidate  : 정규화 제목 word-bigram Jaccard > 0.55 (서버 전용)
 *   - option_imbalance : single_select 옵션 < 2개 또는 > 7개
 *
 * 임계값·축 커버리지는 파일 상단 상수로 외출. R_10.05 deal/visitor 축은 PRD-02 Voice § 4 기준.
 *
 * 클라이언트 대응판은 S_Sensor/admin/lib/studio_lint.ts (merge_candidate 제외 4종 동일 임계).
 */

// ─── 임계값·상수 ────────────────────────────────────────────────────────────

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

export const TIME_OVERRUN_MULTIPLIER = 1.1; // estimated_minutes × 60 × 1.1 까지는 허용
export const DEFAULT_TARGET_MINUTES = { dealer: 6, visitor: 2 } as const;

export const REQUIRED_AXES: Record<'dealer' | 'visitor', string[]> = {
  dealer: ['scale', 'usage', 'annual_operating_hours', 'annual_deal_rub', 'fleet_size', 'decision_role'],
  visitor: ['scale', 'usage', 'fleet_size', 'decision_role'],
};

export const MERGE_JACCARD_THRESHOLD = 0.55;
export const OPTION_MIN = 2;
export const OPTION_MAX = 7;

// ─── 타입 ───────────────────────────────────────────────────────────────────

export type TargetAudience = 'dealer' | 'visitor';
export type Severity = 'warn' | 'error';
export type LintCode =
  | 'time_overrun'
  | 'missing_required'
  | 'language_gap'
  | 'merge_candidate'
  | 'option_imbalance';

export interface StudioQuestion {
  id?: string;
  type: string;
  title_ru?: string;
  title_en?: string;
  title_ko?: string;
  axis?: string;
  options?: unknown;
  required?: boolean;
  ai_generated?: boolean;
  edited_at?: string | null;
  [k: string]: unknown;
}

export interface StudioSpec {
  title?: string;
  description?: string;
  language_default?: string;
  estimated_minutes?: number;
  questions: StudioQuestion[];
  [k: string]: unknown;
}

export interface LintWarning {
  code: LintCode;
  severity: Severity;
  question_ids: string[];
  message_ko: string;
  /** UI에서 클릭 시 적용할 patch 후보 — 부분 spec 변경 사항 */
  suggestion_patch?: Partial<StudioSpec> | { questions?: Partial<StudioQuestion>[] };
}

export interface LintOptions {
  target_audience: TargetAudience;
  /** merge_candidate 같은 서버 전용 체크를 끄려면 false (클라이언트 모듈에서 사용) */
  include_semantic?: boolean;
}

// ─── 메인 ───────────────────────────────────────────────────────────────────

export function lintSurveySpec(spec: StudioSpec, opts: LintOptions): LintWarning[] {
  const out: LintWarning[] = [];
  const qs = Array.isArray(spec.questions) ? spec.questions : [];
  const includeSemantic = opts.include_semantic !== false;

  out.push(...checkTimeOverrun(spec, qs, opts.target_audience));
  out.push(...checkMissingRequired(qs, opts.target_audience));
  out.push(...checkLanguageGap(spec, qs));
  out.push(...checkOptionImbalance(qs));
  if (includeSemantic) out.push(...checkMergeCandidates(qs));

  return out;
}

// ─── 개별 체크 ───────────────────────────────────────────────────────────────

function checkTimeOverrun(
  spec: StudioSpec,
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

function checkMissingRequired(
  qs: StudioQuestion[],
  target: TargetAudience,
): LintWarning[] {
  const out: LintWarning[] = [];

  // NPS
  const hasNps = qs.some((q) => q.type === 'nps');
  if (!hasNps) {
    out.push({
      code: 'missing_required',
      severity: 'error',
      question_ids: [],
      message_ko: 'NPS(0~10) 문항이 누락되었습니다. R_10.08 기준 필수.',
    });
  }

  // consent
  const hasConsent = qs.some((q) => q.type === 'consent');
  if (!hasConsent) {
    out.push({
      code: 'missing_required',
      severity: 'error',
      question_ids: [],
      message_ko: 'consent(data_collection) 문항이 누락되었습니다. PII 동의 필수.',
    });
  }

  // axis 커버리지
  const required = REQUIRED_AXES[target];
  const presentAxes = new Set(
    qs.map((q) => (typeof q.axis === 'string' ? q.axis : '')).filter(Boolean),
  );
  const missingAxes = required.filter((a) => !presentAxes.has(a));
  if (missingAxes.length > 0) {
    out.push({
      code: 'missing_required',
      severity: 'warn',
      question_ids: [],
      message_ko: `${target} 필수 축 누락: ${missingAxes.join(', ')}. R_10.05 segment 매칭 정확도 저하.`,
    });
  }

  return out;
}

function checkLanguageGap(spec: StudioSpec, qs: StudioQuestion[]): LintWarning[] {
  const out: LintWarning[] = [];
  const lang = spec.language_default ?? 'ru';
  const field = lang === 'ko' ? 'title_ko' : lang === 'en' ? 'title_en' : 'title_ru';

  // language_default 누락
  const missingDefault = qs.filter((q) => !str(q[field as keyof StudioQuestion])).map(
    (q) => q.id ?? '',
  ).filter(Boolean);
  if (missingDefault.length > 0) {
    out.push({
      code: 'language_gap',
      severity: 'warn',
      question_ids: missingDefault,
      message_ko: `language_default=${lang}이지만 ${field}가 비어있는 질문 ${missingDefault.length}건.`,
    });
  }

  // title_ru 누락 (러시아 부스 필수)
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
        message_ko: `single_select 옵션이 ${opts.length}개. 응답 부담 ↑ — ${OPTION_MAX}개 이하 권장.`,
      });
    }
  }
  return out;
}

function checkMergeCandidates(qs: StudioQuestion[]): LintWarning[] {
  const out: LintWarning[] = [];
  const tokens = qs.map((q) => bigrams(normalize(pickTitle(q))));
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const sim = jaccard(tokens[i], tokens[j]);
      if (sim > MERGE_JACCARD_THRESHOLD) {
        out.push({
          code: 'merge_candidate',
          severity: 'warn',
          question_ids: [qs[i].id ?? '', qs[j].id ?? ''].filter(Boolean),
          message_ko: `유사 질문 후보 (Jaccard ${sim.toFixed(2)}): "${truncate(pickTitle(qs[i]))}" ↔ "${truncate(pickTitle(qs[j]))}". 병합/제거 검토.`,
        });
      }
    }
  }
  return out;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function pickTitle(q: StudioQuestion): string {
  return str(q.title_ru) || str(q.title_ko) || str(q.title_en) || '';
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function bigrams(s: string): Set<string> {
  const words = s.split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) {
    out.add(`${words[i]}_${words[i + 1]}`);
  }
  // 1-gram도 일부 반영 — 짧은 질문 대응
  for (const w of words) out.add(w);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function truncate(s: string): string {
  return s.length <= 40 ? s : `${s.slice(0, 40)}…`;
}
