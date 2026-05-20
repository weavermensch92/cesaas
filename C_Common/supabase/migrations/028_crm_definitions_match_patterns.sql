-- ============================================================================
-- 028_crm_definitions_match_patterns.sql
-- crm_definitions — Chrome MV3 match patterns + capture_paths 추가.
-- Admin UI(/sensor/crm)에서 새 CRM을 등록해도 매니페스트가 자동 확장되도록.
-- ============================================================================

ALTER TABLE crm_definitions
  ADD COLUMN IF NOT EXISTS match_patterns TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS capture_paths  TEXT[] NOT NULL DEFAULT ARRAY['/']::TEXT[];

COMMENT ON COLUMN crm_definitions.match_patterns
  IS 'Chrome MV3 match patterns (host_permissions + content_scripts.matches). 예: https://*.bitrix24.com/*';
COMMENT ON COLUMN crm_definitions.capture_paths
  IS 'content.js가 캡쳐를 트리거할 pathname prefix 목록. 예: ["/crm/"]';

-- 기존 bitrix24 row 보강
UPDATE crm_definitions
SET match_patterns = ARRAY[
      'https://bitrix.gkcompany.pro/*',
      'https://*.bitrix24.com/*',
      'https://*.bitrix24.ru/*'
    ],
    capture_paths  = ARRAY['/crm/']
WHERE id = 'bitrix24'
  AND (match_patterns IS NULL OR array_length(match_patterns, 1) IS NULL);
