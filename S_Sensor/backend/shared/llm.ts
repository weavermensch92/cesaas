// Anthropic 래퍼 — C_05_LLM_정책 + 013_llm_observability.
// 키: Supabase Vault (get_anthropic_api_key RPC) → 캐시 60s → env fallback.
// 사용량: 호출 직후 record_llm_usage RPC 로 1행 INSERT (자동 비용 계산).

import Anthropic from 'anthropic';
import { ApiError } from './errors.ts';
import { log } from './logger.ts';
import { envOptional } from './env.ts';
import { db } from './db.ts';
import { loadRule } from './rules.ts';

export const DEFAULT_MODEL = 'claude-opus-4-7';
const MAX_RETRIES = 5;
const BACKOFF_CAP_MS = 16000;
const KEY_CACHE_TTL_MS = 60_000;

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
  /** 호출 콘텍스트 (로그 + usage 행 정보) */
  context?: Record<string, unknown>;
  /** 사용 로그 function_name (미지정 시 FUNCTION_NAME env 또는 'unknown') */
  functionName?: string;
  /** request 추적 id (Edge Function 의 x-request-id 등) */
  requestId?: string;
}

export interface CallResult {
  text: string;
  model: string;
  ruleVersion: string;
  promptVersion: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface CitationRef {
  url: string;
  title?: string;
  cited_text?: string;
}

export interface SearchCallResult extends CallResult {
  citations: CitationRef[];
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

// ─── API 키 해석 (Vault 우선, env fallback, 60s 캐시) ─────────────────────
let cachedKey: string | null = null;
let cachedKeyAt = 0;

async function resolveApiKey(): Promise<string> {
  const now = Date.now();
  if (cachedKey && (now - cachedKeyAt) < KEY_CACHE_TTL_MS) return cachedKey;
  try {
    const { data, error } = await db().rpc('get_anthropic_api_key');
    if (!error && typeof data === 'string' && data.length > 10) {
      cachedKey = data;
      cachedKeyAt = now;
      return cachedKey;
    }
  } catch (e) {
    log('warn', 'vault key lookup failed, falling back to env', {
      reason: e instanceof Error ? e.message : String(e),
    });
  }
  const fromEnv = envOptional('ANTHROPIC_API_KEY', '');
  if (fromEnv) {
    cachedKey = fromEnv;
    cachedKeyAt = now;
    return cachedKey;
  }
  throw new ApiError('config_missing', 'ANTHROPIC_API_KEY: vault 미설정 + env 미설정');
}

// 클라이언트는 키마다 별도 — 회전 시 자동 재생성
let cachedClient: { key: string; client: Anthropic } | null = null;
async function client(): Promise<Anthropic> {
  const key = await resolveApiKey();
  if (cachedClient && cachedClient.key === key) return cachedClient.client;
  const c = new Anthropic({ apiKey: key });
  cachedClient = { key, client: c };
  return c;
}

// ─── 사용량 기록 ─────────────────────────────────────────────────────────
async function recordUsage(args: {
  functionName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  ruleId?: string;
  promptKey?: string;
  requestId?: string;
  latencyMs?: number;
  error?: string;
}): Promise<void> {
  try {
    await db().rpc('record_llm_usage', {
      p_function_name: args.functionName,
      p_model: args.model,
      p_input_tokens: args.inputTokens,
      p_output_tokens: args.outputTokens,
      p_cache_read_tokens: args.cacheReadTokens ?? 0,
      p_cache_creation_tokens: args.cacheCreationTokens ?? 0,
      p_rule_id: args.ruleId ?? null,
      p_prompt_key: args.promptKey ?? null,
      p_request_id: args.requestId ?? null,
      p_latency_ms: args.latencyMs ?? null,
      p_error: args.error ?? null,
    });
  } catch (e) {
    log('warn', 'failed to record llm_usage', {
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

function getFunctionName(opts: CallOptions): string {
  if (opts.functionName) return opts.functionName;
  return envOptional('SB_EXECUTION_ID', '').split(':')[0] || envOptional('FUNCTION_NAME', 'unknown');
}

// ─── 메인 ─────────────────────────────────────────────────────────────────
export async function callRule(
  ruleId: string,
  promptKey: string,
  opts: CallOptions = {},
): Promise<CallResult> {
  const { body, version } = await loadRule<Record<string, unknown>>(ruleId);
  // harness1 스키마: body.templates[promptKey]. 레거시: body[promptKey]. 전환기 양쪽 지원.
  const templates = (body as { templates?: Record<string, PromptTemplate> }).templates;
  const tpl = (templates?.[promptKey] ?? (body as Record<string, PromptTemplate>)[promptKey]) as
    | PromptTemplate
    | undefined;
  if (!tpl || typeof tpl.system !== 'string' || typeof tpl.user !== 'string') {
    throw new ApiError('internal_error', `prompt template missing: ${ruleId}#${promptKey}`);
  }
  const out = await call(tpl, opts, ruleId, promptKey, tpl.version ?? null);
  return { ...out, ruleVersion: version, promptVersion: tpl.version ?? null };
}

// ─── web_search 도구 사용 호출 ────────────────────────────────────────────
// callRule 과 동일한 R_10.06 템플릿 로드 흐름을 따르되, Anthropic web_search 도구를 활성화.
// 호출부: admin-crm-suggest 등 외부 사실 조사가 필요한 경로.
export async function callRuleWithSearch(
  ruleId: string,
  promptKey: string,
  opts: CallOptions & { maxWebUses?: number; userVars?: Record<string, string> } = {},
): Promise<SearchCallResult> {
  const { body, version } = await loadRule<Record<string, unknown>>(ruleId);
  const templates = (body as { templates?: Record<string, PromptTemplate> }).templates;
  const tpl = (templates?.[promptKey] ?? (body as Record<string, PromptTemplate>)[promptKey]) as
    | PromptTemplate
    | undefined;
  if (!tpl || typeof tpl.system !== 'string' || typeof tpl.user !== 'string') {
    throw new ApiError('internal_error', `prompt template missing: ${ruleId}#${promptKey}`);
  }

  // {key} placeholder 치환
  let userText = opts.userText ?? tpl.user;
  if (opts.userVars) {
    for (const [k, v] of Object.entries(opts.userVars)) {
      userText = userText.split(`{${k}}`).join(v);
    }
  }

  const model = opts.model ?? envOptional('ANTHROPIC_MODEL_PRIMARY', DEFAULT_MODEL);
  const maxTokens = opts.maxTokens ?? (typeof tpl.max_tokens === 'number' ? tpl.max_tokens : 3000);
  const fnName = getFunctionName(opts);
  const maxUses = opts.maxWebUses ?? 5;
  const startedAt = Date.now();

  let attempt = 0;
  let backoff = 1000;
  while (true) {
    try {
      const c = await client();
      // deno-lint-ignore no-explicit-any
      const res: any = await (c as any).messages.create({
        model,
        max_tokens: maxTokens,
        system: tpl.system,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      });

      const blocks: unknown[] = Array.isArray(res.content) ? res.content : [];
      const textParts: string[] = [];
      const citations: CitationRef[] = [];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        // deno-lint-ignore no-explicit-any
        const blk = b as any;
        if (blk.type === 'text' && typeof blk.text === 'string') {
          textParts.push(blk.text);
          if (Array.isArray(blk.citations)) {
            for (const ct of blk.citations) {
              if (ct && typeof ct.url === 'string') {
                citations.push({ url: ct.url, title: ct.title, cited_text: ct.cited_text });
              }
            }
          }
        }
        if (blk.type === 'web_search_tool_result' && Array.isArray(blk.content)) {
          for (const r of blk.content) {
            if (r && typeof r.url === 'string') {
              citations.push({ url: r.url, title: r.title });
            }
          }
        }
      }
      const text = textParts.join('\n').trim();

      // deno-lint-ignore no-explicit-any
      const u = res.usage as any;
      const inputTokens = u?.input_tokens ?? 0;
      const outputTokens = u?.output_tokens ?? 0;
      const cacheReadTokens = u?.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = u?.cache_creation_input_tokens ?? 0;

      void recordUsage({
        functionName: fnName,
        model: res.model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        ruleId,
        promptKey,
        requestId: opts.requestId,
        latencyMs: Date.now() - startedAt,
      });

      return {
        text,
        model: res.model,
        ruleVersion: version,
        promptVersion: (tpl.version as string | undefined) ?? null,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: cacheReadTokens,
          cache_creation_input_tokens: cacheCreationTokens,
        },
        citations: dedupCitations(citations),
      };
    } catch (err) {
      attempt += 1;
      if (!isRetryable(err) || attempt >= MAX_RETRIES) {
        const status = (err as AnthropicErrLike).status;
        const reason = err instanceof Error ? err.message : String(err);
        log('error', 'LLM web-search call failed (terminal)', { attempt, status, ...opts.context });
        void recordUsage({
          functionName: fnName,
          model,
          inputTokens: 0,
          outputTokens: 0,
          ruleId,
          promptKey,
          requestId: opts.requestId,
          latencyMs: Date.now() - startedAt,
          error: `status=${status ?? 'n/a'} ${reason}`.slice(0, 500),
        });
        if (status === 429) throw new ApiError('llm_rate_limited', 'Anthropic rate limit', { attempt });
        if (status === 401 || status === 403) {
          cachedKey = null;
          cachedClient = null;
        }
        throw new ApiError('llm_failed', 'Anthropic web-search call failed', { attempt, reason });
      }
      log('warn', 'LLM web-search retry', { attempt, backoff_ms: backoff, ...opts.context });
      await sleep(backoff);
      backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
    }
  }
}

function dedupCitations(list: CitationRef[]): CitationRef[] {
  const seen = new Set<string>();
  const out: CitationRef[] = [];
  for (const c of list) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

async function call(
  template: PromptTemplate,
  opts: CallOptions,
  ruleId?: string,
  promptKey?: string,
  promptVersion?: string | null,
): Promise<Omit<CallResult, 'ruleVersion' | 'promptVersion'>> {
  const model = opts.model ?? envOptional('ANTHROPIC_MODEL_PRIMARY', DEFAULT_MODEL);
  const maxTokens = opts.maxTokens ?? (typeof template.max_tokens === 'number' ? template.max_tokens : 2000);
  const fnName = getFunctionName(opts);

  const content: Array<ImageBlock | { type: 'text'; text: string }> = [];
  if (opts.images?.length) content.push(...opts.images);
  content.push({ type: 'text', text: opts.userText ?? template.user });

  let attempt = 0;
  let backoff = 1000;
  const startedAt = Date.now();
  while (true) {
    try {
      const c = await client();
      const res = await c.messages.create({
        model,
        max_tokens: maxTokens,
        system: template.system,
        // deno-lint-ignore no-explicit-any
        messages: [{ role: 'user', content: content as any }],
      });
      const first = res.content[0];
      const text = first && first.type === 'text' ? first.text : '';
      // deno-lint-ignore no-explicit-any
      const u = res.usage as any;
      const inputTokens = u?.input_tokens ?? 0;
      const outputTokens = u?.output_tokens ?? 0;
      const cacheReadTokens = u?.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = u?.cache_creation_input_tokens ?? 0;

      void recordUsage({
        functionName: fnName,
        model: res.model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        ruleId,
        promptKey,
        requestId: opts.requestId,
        latencyMs: Date.now() - startedAt,
      });

      return {
        text,
        model: res.model,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: cacheReadTokens,
          cache_creation_input_tokens: cacheCreationTokens,
        },
      };
    } catch (err) {
      attempt += 1;
      if (!isRetryable(err) || attempt >= MAX_RETRIES) {
        const status = (err as AnthropicErrLike).status;
        const reason = err instanceof Error ? err.message : String(err);
        log('error', 'LLM call failed (terminal)', { attempt, status, ...opts.context });
        void recordUsage({
          functionName: fnName,
          model,
          inputTokens: 0,
          outputTokens: 0,
          ruleId,
          promptKey,
          requestId: opts.requestId,
          latencyMs: Date.now() - startedAt,
          error: `status=${status ?? 'n/a'} ${reason}`.slice(0, 500),
        });
        if (status === 429) {
          throw new ApiError('llm_rate_limited', 'Anthropic rate limit', { attempt });
        }
        if (status === 401 || status === 403) {
          // 키 캐시 무효화 — 회전 직후 회복
          cachedKey = null;
          cachedClient = null;
        }
        throw new ApiError('llm_failed', 'Anthropic call failed', { attempt, reason });
      }
      log('warn', 'LLM retry', { attempt, backoff_ms: backoff, ...opts.context });
      await sleep(backoff);
      backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
    }
  }
}
