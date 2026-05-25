/**
 * POST /admin-crm-suggest — URL → CRM 매트릭스 자동 추론 (admin 전용).
 *
 * serves: ['hd_admin']
 * direction: 'downward'
 * harness: 1
 *
 * Body:   { url: "https://..." }
 * Return: { suggestion: {...}, citations: [{url,title?}], model, rule_version, prompt_version, confidence }
 *
 * 흐름:
 *   1) requireAdmin
 *   2) URL 검증
 *   3) callRuleWithSearch(R_10.06, 'crm_suggest', { userVars: { url } })
 *   4) 결과 JSON 파싱 + 최소 sanity (regex compile-test, kebab id, match_patterns shape)
 *   5) 응답
 */

import { requireAdmin } from 'shared/admin_auth.ts';
import { ApiError, corsPreflight, jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { requestLogger } from 'shared/logger.ts';
import { callRuleWithSearch } from 'shared/llm.ts';

const ROUTE = '/admin-crm-suggest';
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

interface ScreenPattern {
  screen: string;
  url_regex: string;
  entity_extract_group?: number;
}

interface Suggestion {
  id: string;
  name: string;
  description: string | null;
  host_pattern: string;
  match_patterns: string[];
  capture_paths: string[];
  screen_patterns: ScreenPattern[];
  confidence: number | null;
  confidence_note: string | null;
}

Deno.serve(async (req: Request) => {
  const cors = corsPreflight(req);
  if (cors) return cors;
  const log = requestLogger(req, { route: ROUTE });
  try {
    if (req.method !== 'POST') {
      throw new ApiError('bad_request', 'method not allowed', { method: req.method });
    }
    await requireAdmin(req);

    const raw = await req.json().catch(() => null) as { url?: unknown } | null;
    const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
    if (!url) throw new ApiError('validation_failed', 'url required (string, non-empty)');
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new ApiError('validation_failed', `url must be absolute (https://...)`, { url }); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ApiError('validation_failed', 'url must be http(s)', { protocol: parsed.protocol });
    }

    const result = await callRuleWithSearch('R_10.06_PromptTemplates', 'crm_suggest', {
      userVars: { url },
      maxWebUses: 5,
      requestId: log.requestId,
      context: { route: ROUTE, host: parsed.host },
    });

    const suggestion = parseAndValidate(result.text);

    log.info('crm-suggest produced', {
      host: parsed.host,
      id: suggestion.id,
      screens: suggestion.screen_patterns.length,
      citations: result.citations.length,
    });

    return jsonResponse(200, {
      suggestion,
      citations: result.citations,
      model: result.model,
      rule_version: result.ruleVersion,
      prompt_version: result.promptVersion,
    }, log.requestId);
  } catch (err) {
    log.error('admin-crm-suggest failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

function parseAndValidate(text: string): Suggestion {
  if (!text) throw new ApiError('llm_failed', 'empty response text');
  const json = extractJson(text);
  if (!json || typeof json !== 'object') {
    throw new ApiError('llm_failed', 'response is not a JSON object');
  }
  const o = json as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  if (!ID_RE.test(id)) {
    throw new ApiError('llm_failed', `id must match ${ID_RE} (got "${id}")`);
  }
  const name = String(o.name ?? '').trim();
  if (!name) throw new ApiError('llm_failed', 'name missing');
  const host_pattern = String(o.host_pattern ?? '').trim();
  if (!host_pattern) throw new ApiError('llm_failed', 'host_pattern missing');
  try { new RegExp(host_pattern); }
  catch (e) { throw new ApiError('llm_failed', `host_pattern invalid: ${(e as Error).message}`); }

  const match_patterns = Array.isArray(o.match_patterns)
    ? o.match_patterns.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (match_patterns.length === 0) {
    throw new ApiError('llm_failed', 'match_patterns ≥1 required');
  }
  for (const m of match_patterns) {
    if (!/^https?:\/\/[^/]+\/.*/.test(m) && m !== '<all_urls>') {
      throw new ApiError('llm_failed', `match_patterns shape invalid: "${m}"`);
    }
  }

  const capture_paths_in = Array.isArray(o.capture_paths)
    ? o.capture_paths.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const capture_paths = capture_paths_in.length ? capture_paths_in : ['/'];
  for (const p of capture_paths) {
    if (!p.startsWith('/')) throw new ApiError('llm_failed', `capture_paths must start with "/": "${p}"`);
  }

  const sp_in = Array.isArray(o.screen_patterns) ? o.screen_patterns : [];
  const screen_patterns: ScreenPattern[] = [];
  for (const it of sp_in) {
    if (!it || typeof it !== 'object') continue;
    const so = it as Record<string, unknown>;
    const screen = String(so.screen ?? '').trim();
    const url_regex = String(so.url_regex ?? '').trim();
    if (!screen || !url_regex) continue;
    try { new RegExp(url_regex); }
    catch { continue; }
    const out: ScreenPattern = { screen, url_regex };
    if (so.entity_extract_group != null) {
      const g = Number(so.entity_extract_group);
      if (Number.isInteger(g) && g >= 1) out.entity_extract_group = g;
    }
    screen_patterns.push(out);
  }
  if (screen_patterns.length === 0) {
    throw new ApiError('llm_failed', 'screen_patterns ≥1 (after sanitization) required');
  }

  const description = o.description == null ? null : String(o.description).trim() || null;
  const confidence = typeof o.confidence === 'number' ? o.confidence : null;
  const confidence_note = o.confidence_note == null ? null : String(o.confidence_note).trim() || null;

  return { id, name, description, host_pattern, match_patterns, capture_paths, screen_patterns, confidence, confidence_note };
}

function extractJson(text: string): unknown {
  // 모델이 markdown fence를 끼워 보내는 경우 대비 — 첫 { ... 마지막 }을 추출.
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) {
    const f = tryParse(fence[1].trim());
    if (f !== undefined) return f;
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    const s = tryParse(slice);
    if (s !== undefined) return s;
  }
  return null;
}

function tryParse(s: string): unknown | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}
