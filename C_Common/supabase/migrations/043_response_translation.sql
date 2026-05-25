-- 043_response_translation.sql
-- 자유 텍스트 응답 자동 번역 인프라 (ko/en/ru).
--
-- 변경 요지:
--   1) response_answers 확장 — translations JSONB · translation_status · translation_model · translation_at
--   2) responses 확장 — translations_status (rollup: pending/partial/done/none)
--   3) 신규 큐 response_translation_queue (007_normalize_queue 패턴 답습)
--   4) RPC 3종:
--      - enqueue_response_translation(p_response_id, p_question_id, p_text, p_source_lang)
--      - lock_pending_translations(p_limit) → SKIP LOCKED 락
--      - save_translation(p_queue_id, p_ko, p_en, p_ru, p_model)
--
-- 호출:
--   responses-receive 핸들러가 save 직후 자유 텍스트(text_short/text_long/`other_text`) 답변마다
--   enqueue_response_translation을 호출 (best-effort).
--   voice-translate-worker Edge Function이 1분 cron으로 lock_pending_translations → callRule → save_translation.

BEGIN;

-- ============================================================================
-- 1. response_answers 확장
-- ============================================================================
ALTER TABLE response_answers
  ADD COLUMN IF NOT EXISTS translations JSONB,
  ADD COLUMN IF NOT EXISTS translation_status TEXT
    CHECK (translation_status IS NULL OR translation_status IN ('pending','processing','done','skipped','failed')),
  ADD COLUMN IF NOT EXISTS translation_model TEXT,
  ADD COLUMN IF NOT EXISTS translation_at TIMESTAMPTZ;

COMMENT ON COLUMN response_answers.translations IS
  'LLM 자동 번역 결과 {ko, en, ru}. 원문은 answer 컬럼. 자유 텍스트 응답에만 채워짐.';
COMMENT ON COLUMN response_answers.translation_status IS
  'pending: 큐 대기 · processing: 처리 중 · done: 완료 · skipped: 텍스트 무 · failed: 재시도 한계 초과.';

-- ============================================================================
-- 2. responses rollup 상태
-- ============================================================================
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS translations_status TEXT
    CHECK (translations_status IS NULL OR translations_status IN ('none','pending','partial','done'));

COMMENT ON COLUMN responses.translations_status IS
  '응답 내 자유 텍스트 번역 진척 — none: 자유텍스트 없음 · pending: 모두 대기 · partial: 일부 완료 · done: 전부.';

-- ============================================================================
-- 3. response_translation_queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS response_translation_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id   UUID NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id   TEXT NOT NULL REFERENCES survey_questions(id),
  source_lang   TEXT NOT NULL DEFAULT 'ru' CHECK (source_lang IN ('ko','en','ru')),
  answer_text   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at     TIMESTAMPTZ,
  locked_by     TEXT,
  completed_at  TIMESTAMPTZ,
  UNIQUE (response_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_tq_pending
  ON response_translation_queue (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tq_response
  ON response_translation_queue (response_id);

ALTER TABLE response_translation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY tq_service_role_all ON response_translation_queue
  FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 4. RPC — enqueue_response_translation
-- ============================================================================
CREATE OR REPLACE FUNCTION enqueue_response_translation(
  p_response_id UUID,
  p_question_id TEXT,
  p_answer_text TEXT,
  p_source_lang TEXT DEFAULT 'ru'
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  _id UUID;
  _trimmed TEXT;
BEGIN
  _trimmed := COALESCE(NULLIF(trim(p_answer_text), ''), NULL);
  IF _trimmed IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO response_translation_queue (response_id, question_id, source_lang, answer_text)
  VALUES (p_response_id, p_question_id, COALESCE(p_source_lang, 'ru'), _trimmed)
  ON CONFLICT (response_id, question_id) DO UPDATE
    SET answer_text = EXCLUDED.answer_text,
        source_lang = EXCLUDED.source_lang,
        status = 'pending',
        attempts = 0,
        last_error = NULL,
        scheduled_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        completed_at = NULL
  RETURNING id INTO _id;

  -- response_answers 상태도 'pending'으로 (없으면 INSERT 안 함 — save_response가 row 먼저 만듦)
  UPDATE response_answers
     SET translation_status = 'pending'
   WHERE response_id = p_response_id AND question_id = p_question_id;

  -- responses rollup 상태
  UPDATE responses
     SET translations_status = COALESCE(
       CASE
         WHEN translations_status = 'done' THEN 'partial'
         WHEN translations_status IN ('partial','pending') THEN translations_status
         ELSE 'pending'
       END,
       'pending'
     )
   WHERE id = p_response_id;

  RETURN _id;
END;
$$;

COMMENT ON FUNCTION enqueue_response_translation IS
  '자유 텍스트 응답을 번역 큐에 enqueue. 빈 텍스트는 skip. 멱등 (ON CONFLICT DO UPDATE).';

-- ============================================================================
-- 5. RPC — lock_pending_translations (SKIP LOCKED)
-- ============================================================================
CREATE OR REPLACE FUNCTION lock_pending_translations(
  p_limit INT DEFAULT 20,
  p_worker_id TEXT DEFAULT 'voice-translate-worker'
) RETURNS SETOF response_translation_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE response_translation_queue q
     SET status = 'processing',
         locked_at = now(),
         locked_by = p_worker_id,
         attempts = q.attempts + 1
   WHERE q.id IN (
     SELECT id FROM response_translation_queue
      WHERE status = 'pending' AND scheduled_at <= now()
      ORDER BY scheduled_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING q.*;
END;
$$;

COMMENT ON FUNCTION lock_pending_translations IS
  'pending 큐에서 N건 잡아 status=processing으로 atomic 전환. SKIP LOCKED로 worker 동시 안전.';

-- ============================================================================
-- 6. RPC — save_translation
-- ============================================================================
CREATE OR REPLACE FUNCTION save_translation(
  p_queue_id    UUID,
  p_ko          TEXT,
  p_en          TEXT,
  p_ru          TEXT,
  p_model       TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  _resp UUID;
  _qid  TEXT;
  _all_done BOOLEAN;
BEGIN
  SELECT response_id, question_id INTO _resp, _qid
    FROM response_translation_queue WHERE id = p_queue_id;
  IF _resp IS NULL THEN
    RAISE EXCEPTION 'queue row not found: %', p_queue_id;
  END IF;

  -- response_answers 갱신
  UPDATE response_answers
     SET translations = jsonb_build_object('ko', p_ko, 'en', p_en, 'ru', p_ru),
         translation_status = 'done',
         translation_model = p_model,
         translation_at = now()
   WHERE response_id = _resp AND question_id = _qid;

  -- queue 완료
  UPDATE response_translation_queue
     SET status = 'done',
         completed_at = now(),
         last_error = NULL
   WHERE id = p_queue_id;

  -- responses rollup — 같은 응답의 pending 큐가 남았는지 확인
  SELECT NOT EXISTS (
    SELECT 1 FROM response_translation_queue
     WHERE response_id = _resp AND status IN ('pending','processing','failed')
  ) INTO _all_done;

  UPDATE responses
     SET translations_status = CASE WHEN _all_done THEN 'done' ELSE 'partial' END
   WHERE id = _resp;
END;
$$;

COMMENT ON FUNCTION save_translation IS
  '큐 1건 완료 — response_answers.translations 채움 + 큐 done. 같은 응답의 모든 큐가 끝났으면 responses.translations_status=done.';

-- ============================================================================
-- 7. RPC — fail_translation (재시도 백오프)
-- ============================================================================
CREATE OR REPLACE FUNCTION fail_translation(
  p_queue_id  UUID,
  p_error     TEXT,
  p_max_attempts INT DEFAULT 5
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  _attempts INT;
BEGIN
  SELECT attempts INTO _attempts FROM response_translation_queue WHERE id = p_queue_id;
  IF _attempts IS NULL THEN RETURN; END IF;

  IF _attempts >= p_max_attempts THEN
    -- 최종 실패
    UPDATE response_translation_queue
       SET status = 'failed', last_error = p_error, completed_at = now()
     WHERE id = p_queue_id;
    UPDATE response_answers ra
       SET translation_status = 'failed'
      FROM response_translation_queue q
     WHERE q.id = p_queue_id
       AND ra.response_id = q.response_id
       AND ra.question_id = q.question_id;
  ELSE
    -- 백오프 재시도 (2^attempts 분)
    UPDATE response_translation_queue
       SET status = 'pending',
           locked_at = NULL, locked_by = NULL,
           scheduled_at = now() + (power(2, _attempts)::int || ' minutes')::interval,
           last_error = p_error
     WHERE id = p_queue_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION fail_translation IS
  '워커 실패 처리 — attempts ≥ max면 failed. 미만이면 백오프 scheduled_at으로 pending 복귀.';

-- ============================================================================
-- 검증
-- ============================================================================
DO $verify$
DECLARE
  _has_col INT;
BEGIN
  -- response_answers 컬럼
  SELECT COUNT(*) INTO _has_col
    FROM information_schema.columns
    WHERE table_name = 'response_answers'
      AND column_name IN ('translations','translation_status','translation_model','translation_at');
  IF _has_col != 4 THEN
    RAISE EXCEPTION '043 verification failed: response_answers translation columns = % (expected 4)', _has_col;
  END IF;

  -- queue 테이블
  SELECT COUNT(*) INTO _has_col
    FROM information_schema.tables WHERE table_name = 'response_translation_queue';
  IF _has_col != 1 THEN
    RAISE EXCEPTION '043 verification failed: response_translation_queue table missing';
  END IF;

  -- RPC
  SELECT COUNT(*) INTO _has_col
    FROM information_schema.routines
    WHERE routine_name IN ('enqueue_response_translation','lock_pending_translations','save_translation','fail_translation');
  IF _has_col != 4 THEN
    RAISE EXCEPTION '043 verification failed: RPC count = % (expected 4)', _has_col;
  END IF;
END
$verify$;

COMMIT;
