/**
 * Anthropic 호출 래퍼 — C_05_LLM_정책.md.
 * 모델 기본값: claude-opus-4-7 (Sensor 정규화·Studio).
 * 429·529·5xx 지수 백오프 (1·2·4·8·16s, max 5회).
 * 프롬프트는 R_10.06 YAML에서 로드 — 하드코드 금지.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from './errors.js';
import { logger } from './logger.js';
import { loadRules } from './rules.js';

export const DEFAULT_MODEL = 'claude-opus-4-7';
export const FALLBACK_MODEL = 'claude-sonnet-4-6';

export interface LlmClientOptions {
  apiKey?: string;
  defaultModel?: string;
  /** 백오프 max retries. 기본 5. */
  maxRetries?: number;
}

export interface PromptTemplate {
  system: string;
  user: string;
  /** 룰 정의에 따른 임의 메타 (max_tokens 등) */
  [key: string]: unknown;
}

interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/webp' | 'image/png' | 'image/jpeg';
    data: string;
  };
}

interface TextBlock { type: 'text'; text: string }

type ContentBlock = ImageBlock | TextBlock;

export interface CallOptions {
  model?: string;
  maxTokens?: number;
  images?: ImageBlock[];
  /** 추가 user 텍스트 */
  userText?: string;
}

export interface CallResult {
  text: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

function getEnv(key: string): string | undefined {
  const denoEnv = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv) return denoEnv.get(key);
  if (typeof process !== 'undefined') return process.env[key];
  return undefined;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429 || err.status === 529) return true;
    if (err.status && err.status >= 500) return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export class LlmClient {
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly maxRetries: number;

  constructor(opts: LlmClientOptions = {}) {
    const apiKey = opts.apiKey ?? getEnv('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
    this.client = new Anthropic({ apiKey });
    this.defaultModel = opts.defaultModel ?? getEnv('ANTHROPIC_MODEL_PRIMARY') ?? DEFAULT_MODEL;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  /**
   * R_10.06 룰 이름으로 프롬프트 로드 → 호출.
   *   const out = await llm.callRule('R_10.06_PromptTemplates', 'sensor_13_fields', { images });
   */
  async callRule(
    ruleName: string,
    promptKey: string,
    opts: CallOptions = {},
  ): Promise<CallResult> {
    const rules = await loadRules<Record<string, PromptTemplate>>(ruleName);
    const tpl = rules[promptKey];
    if (!tpl || typeof tpl.system !== 'string' || typeof tpl.user !== 'string') {
      throw new ApiError('internal_error', `prompt template missing: ${ruleName}#${promptKey}`);
    }
    return this.call(tpl, opts);
  }

  async call(template: PromptTemplate, opts: CallOptions = {}): Promise<CallResult> {
    const model = opts.model ?? this.defaultModel;
    const maxTokens = opts.maxTokens
      ?? (typeof template['max_tokens'] === 'number' ? (template['max_tokens'] as number) : 2000);

    const content: ContentBlock[] = [];
    if (opts.images?.length) content.push(...opts.images);
    content.push({ type: 'text', text: opts.userText ?? template.user });

    let attempt = 0;
    let backoff = 1000;
    while (true) {
      try {
        const response = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          system: template.system,
          messages: [{ role: 'user', content }],
        });
        const first = response.content[0];
        const text = first && first.type === 'text' ? first.text : '';
        return {
          text,
          model: response.model,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
        };
      } catch (err) {
        attempt += 1;
        if (!isRetryable(err) || attempt >= this.maxRetries) {
          logger.error('LLM call failed (terminal)', err, { model, attempt });
          if (err instanceof Anthropic.APIError && err.status === 429) {
            throw new ApiError('llm_rate_limited', 'Anthropic rate limit', { attempt });
          }
          throw new ApiError('llm_failed', 'Anthropic call failed', {
            attempt,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        logger.warn('LLM retry', { model, attempt, backoff_ms: backoff });
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 16000);
      }
    }
  }
}

/**
 * Edge Function 내에서 모듈 스코프로 생성하지 말고, 매 요청 또는 worker init에 생성.
 */
export function createLlmClient(opts?: LlmClientOptions): LlmClient {
  return new LlmClient(opts);
}
