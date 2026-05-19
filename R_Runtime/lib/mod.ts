// harness2/lib/mod.ts — 통합 진입점.
// Edge Function / worker에서 단일 import:
//
//   import { applyFullPipeline, evaluateCondition } from '../../../R_Runtime/lib/mod.ts';

// 타입
export type * from './types.ts';

// 룰 로더 + 캐시
export {
  clearAllCache,
  configureLoader,
  getCacheStatus,
  invalidateCache,
  loadRules,
} from './load_rules.ts';

// 조건 / action 평가
export { applyAction, evaluateCondition } from './evaluator.ts';

// R_10 룰 적용
export {
  applyFullPipeline,
  applyLeadQuality,
  applyLeadScoring,
  classifyLeadPriority,
  classifySensorScreen,
  classifyVoiceSegment,
} from './apply_rules.ts';

export type { LeadFullPipelineResult } from './apply_rules.ts';

// 버전 정보
export const HARNESS2_LIB_VERSION = '1.0.0';
export const HARNESS2_LIB_LAST_MODIFIED = '2026-05-19';
