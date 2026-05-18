// Anthropic 래퍼 — C_05_LLM_정책.
// callRule(ruleId, promptKey) → R_10에서 system/user 로드 → 호출. 하드코드 금지.

import Anthropic from 'anthropic';
import { ApiError } from './errors.ts';
import { log } from './logger.ts';
import { envOptional, envRequired } from './env.ts';
import { loadRule } from './rules.ts';

export const DEFAULT_MODEL = 'claude-opus-4-7';
const MAX_RETRIES = 5;
const BACKOFF_CAP_MS = 16000;

export interface PromptTemplate {
  system: string;
  user: string;
  max_tokens?: number;
  version?: string;
  [k: string]: unknown;
}

export interface ImageBlock {
  type: 'image';
  source:
    | { type: 'base64'; media_type: 'image/webp' | 'image/png' | 'image/jpeg'; data: string }
    | { type: 'url'; url: string };
}

export interface CallOptions {
  model?: string;
  maxTokens?: number;
  images?: ImageBlock[];
  userText?: string;
  /** 호출 콘텍스트 (로그용) */
  context?: Record<string, unknown>;
}

export interface CallResult {
  text: string;
  model: string;
  ruleVersion: string;
  promptVersion: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicErrLike { status?: number; message?: string }

function isRetryable(err: unknown): boolean {
  const e = err as AnthropicErrLike;
  if (typeof e.status !== 'number') return false;
  if (e.status === 429 || e.status === 529) return true;
  if (e.status >= 500) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: envRequired('ANTHROPIC_API_KEY') });
  return cached;
}

export async function callRule(
  ruleId: string,
  promptKey: string,
  opts: CallOptions = {},
): Promise<CallResult> {
  const { body, version } = await loadRule<Record<string, PromptTemplate>>(ruleId);
  const tpl = body[promptKey];
  if (!tpl || typeof tpl.system !== 'string' || typeof tpl.user !== 'string') {
    throw new ApiError('internal_error', `prompt template missing: ${ruleId}#${promptKey}`);
  }
  const out = await call(tpl, opts);
  return { ...out, ruleVersion: version, promptVersion: tpl.version ?? null };
}

async function call(template: PromptTemplate, opts: CallOptions): Promise<Omit<CallResult, 'ruleVersion' | 'promptVersion'>> {
  const model = opts.model ?? envOptional('ANTHROPIC_MODEL_PRIMARY', DEFAULT_MODEL);
  const maxTokens = opts.maxTokens ?? (typeof template.max_tokens === 'number' ? template.max_tokens : 2000);

  const content: Array<ImageBlock | { type: 'text'; text: string }> = [];
  if (opts.images?.length) content.push(...opts.images);
  content.push({ type: 'text', text: opts.userText ?? template.user });

  let attempt = 0;
  let backoff = 1000;
  while (true) {
    try {
      const res = await client().messages.create({
        model,
        max_tokens: maxTokens,
        system: template.system,
        // deno-lint-ignore no-explicit-any
        messages: [{ role: 'user', content: content as any }],
      });
      const first = res.content[0];
      const text = first && first.type === 'text' ? first.text : '';
      return {
        text,
        model: res.model,
        usage: {
          input_tokens: res.usage.input_tokens,
          output_tokens: res.usage.output_tokens,
        },
      };
    } catch (err) {
      attempt += 1;
      if (!isRetryable(err) || attempt >= MAX_RETRIES) {
        const status = (err as AnthropicErrLike).status;
        log('error', 'LLM call failed (terminal)', { attempt, status, ...opts.context });
        if (status === 429) {
          throw new ApiError('llm_rate_limited', 'Anthropic rate limit', { attempt });
        }
        throw new ApiError('llm_failed', 'Anthropic call failed', {
          attempt,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      log('warn', 'LLM retry', { attempt, backoff_ms: backoff, ...opts.context });
      await sleep(backoff);
      backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
    }
  }
}
