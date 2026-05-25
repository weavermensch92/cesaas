/**
 * POST /voice-translate-worker — 응답 자유 텍스트 번역 큐 처리.
 *
 * serves: ['system']
 * direction: 'downward'
 * harness: 1
 *
 * 호출: pg_cron + pg_net (1분마다). normalize-worker 패턴 답습.
 *
 * 흐름:
 *   1. lock_pending_translations(p_limit=20) — SKIP LOCKED 락 + status='processing'
 *   2. 각 큐 항목:
 *      a. callRule('R_10.06_PromptTemplates', 'voice_text_translate', { vars:{text, source_lang} })
 *      b. JSON 파싱 {ko, en, ru}
 *      c. save_translation(queue_id, ko, en, ru, model) — response_answers 채움 + 큐 done
 *   3. 실패 시 fail_translation(queue_id, error_msg, max_attempts=5) — 백오프 재시도 또는 최종 failed
 */

import { jsonResponse, toJsonResponse } from 'shared/errors.ts';
import { db } from 'shared/db.ts';
import { requestLogger } from 'shared/logger.ts';
import { callRule } from 'shared/llm.ts';

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;
const MAX_ATTEMPTS = 5;

interface QueueItem {
  id: string;
  response_id: string;
  question_id: string;
  source_lang: 'ko' | 'en' | 'ru';
  answer_text: string;
  attempts: number;
}

interface ItemResult {
  queue_id: string;
  response_id: string;
  question_id: string;
  status: 'done' | 'retry' | 'failed';
  reason?: string;
  model?: string;
}

interface WorkerInput {
  batch_size?: number;
}

Deno.serve(async (req: Request) => {
  const log = requestLogger(req, { route: '/voice-translate-worker' });
  try {
    if (req.method !== 'POST') {
      return jsonResponse(405, { error: 'bad_request', message: 'POST only' }, log.requestId);
    }

    const input = await parseInput(req);
    const batchSize = Math.min(Math.max(input.batch_size ?? DEFAULT_BATCH, 1), MAX_BATCH);

    const { data, error } = await db().rpc('lock_pending_translations', {
      p_limit: batchSize,
      p_worker_id: 'voice-translate-worker',
    });
    if (error) {
      log.error('lock_pending_translations failed', error);
      return jsonResponse(500, {
        error: 'internal_error', message: 'queue lock failed', details: { db: error.message },
      }, log.requestId);
    }

    const items = (data ?? []) as QueueItem[];
    if (items.length === 0) {
      return jsonResponse(200, { processed: 0, results: [] }, log.requestId);
    }
    log.info('translation queue locked', { count: items.length });

    const results: ItemResult[] = [];
    for (const item of items) {
      const r = await processOne(item, log);
      results.push(r);
    }

    return jsonResponse(200, { processed: results.length, results }, log.requestId);
  } catch (err) {
    log.error('voice-translate-worker failed', err);
    return toJsonResponse(err, log.requestId);
  }
});

async function parseInput(req: Request): Promise<WorkerInput> {
  try {
    if (req.headers.get('content-length') === '0') return {};
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as WorkerInput;
  } catch {
    return {};
  }
}

async function processOne(item: QueueItem, log: ReturnType<typeof requestLogger>): Promise<ItemResult> {
  try {
    // callRule은 vars placeholder 치환을 안 함 — userText로 직접 만들어 전달 (segments.ts와 동일 패턴).
    const userText = `원본 언어: ${item.source_lang}\n원문:\n"""\n${item.answer_text}\n"""\n\nJSON만 반환.`;
    const result = await callRule('R_10.06_PromptTemplates', 'voice_text_translate', { userText });

    const parsed = parseTranslationJson(result.text);
    if (!parsed) {
      const reason = `invalid_translation_json: ${(result.text ?? '').slice(0, 120)}`;
      await failItem(item, reason);
      return { queue_id: item.id, response_id: item.response_id, question_id: item.question_id, status: 'retry', reason };
    }

    const model = result.model ?? 'claude-haiku-4-5';
    const { error: saveErr } = await db().rpc('save_translation', {
      p_queue_id: item.id,
      p_ko: parsed.ko,
      p_en: parsed.en,
      p_ru: parsed.ru,
      p_model: model,
    });
    if (saveErr) {
      const reason = `save_translation_failed: ${saveErr.message}`;
      await failItem(item, reason);
      return { queue_id: item.id, response_id: item.response_id, question_id: item.question_id, status: 'retry', reason };
    }

    return { queue_id: item.id, response_id: item.response_id, question_id: item.question_id, status: 'done', model };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.warn('translation failed (retry/fail)', { queue_id: item.id, reason });
    await failItem(item, reason);
    return {
      queue_id: item.id, response_id: item.response_id, question_id: item.question_id,
      status: item.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry',
      reason,
    };
  }
}

async function failItem(item: QueueItem, error: string): Promise<void> {
  const { error: dbErr } = await db().rpc('fail_translation', {
    p_queue_id: item.id,
    p_error: error.slice(0, 500),
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (dbErr) {
    // fail_translation 자체가 실패하면 로깅만 — 큐 row가 processing 상태로 남아 다음 cron이 처리.
    // 이 경우 stuck 회피를 위해 별도 timeout 청소 cron 필요 (별 PR).
  }
}

function parseTranslationJson(text: string | undefined): { ko: string; en: string; ru: string } | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object'
        && typeof parsed.ko === 'string'
        && typeof parsed.en === 'string'
        && typeof parsed.ru === 'string') {
      return { ko: parsed.ko, en: parsed.en, ru: parsed.ru };
    }
  } catch { /* ignore */ }
  return null;
}
