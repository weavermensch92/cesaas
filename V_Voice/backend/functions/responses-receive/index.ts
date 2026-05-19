/**
 * POST /responses-receive — Supabase Edge Function 진입점.
 *
 * 실제 로직: ./handler.ts `handle(req)`.
 * Fly.io Edge fallback (fly_edge/main.ts)도 동일 handler를 import (T_07.01 인프라).
 *
 * serves: ['dealer', 'visitor']
 * direction: 'upward'
 * related_hypothesis: ['V_가설', 'H_채널통합']
 */

import { handle } from './handler.ts';

Deno.serve(handle);
