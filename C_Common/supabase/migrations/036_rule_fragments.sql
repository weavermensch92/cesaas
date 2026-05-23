-- 036_rule_fragments.sql
-- R_10 룰을 fragment(template/rule 단위)로 자연어 → AI 변환하여 작성하는 메타 빌더 데이터 모델.
-- 부모 룰(rule_versions)은 그대로. fragment를 compose 합성 후 publish_rule RPC로 평면 YAML 등록.
-- 변경 없음: rule_versions·publish_rule. 추가만.

CREATE TABLE IF NOT EXISTS rule_fragments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         TEXT NOT NULL,                       -- 'R_10.06_PromptTemplates'
  fragment_path   TEXT NOT NULL,                       -- 'templates.voice_studio_survey_build' (dotted path)
  nl_text         TEXT NOT NULL,                       -- 위버 자연어 원본 (영구 보존)
  generated_yaml  TEXT,                                -- AI 변환 결과 (fragment YAML 본문)
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','archived')),
  imports         UUID[] NOT NULL DEFAULT '{}',        -- 자식 fragment id 배열 (1단계 우선)
  edited_by       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fragments_rule_status
  ON rule_fragments (rule_id, status);

-- 같은 (rule_id, fragment_path)는 active 1개만 — partial UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS uq_fragments_active_path
  ON rule_fragments (rule_id, fragment_path) WHERE status = 'active';

COMMENT ON TABLE rule_fragments IS
  '하네스 2 R_10 룰 fragment — 자연어 원본 + AI 변환 YAML 조각. compose 후 rule_versions에 평면 등록.';

-- active fragments 조회 helper (Edge Function이 SELECT만 호출)
CREATE OR REPLACE FUNCTION get_active_fragments(p_rule_id TEXT)
RETURNS TABLE (id UUID, fragment_path TEXT, generated_yaml TEXT, imports UUID[])
LANGUAGE sql STABLE AS $$
  SELECT id, fragment_path, generated_yaml, imports
  FROM rule_fragments
  WHERE rule_id = p_rule_id AND status = 'active'
  ORDER BY fragment_path;
$$;

COMMENT ON FUNCTION get_active_fragments(TEXT)
  IS 'rule_id별 active fragment 목록. compose 합성용. parent body_yaml과 합쳐 평면 YAML 생성.';

-- RLS — service_role 전권 (publish는 service_role Edge Function에서만)
ALTER TABLE rule_fragments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rule_fragments_service_role ON rule_fragments;
CREATE POLICY rule_fragments_service_role ON rule_fragments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
