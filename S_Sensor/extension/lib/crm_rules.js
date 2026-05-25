// lib/crm_rules.js — 동적 CRM 매트릭스 fetch + chrome.storage.local 캐시.
// background.js에서만 사용. content.js는 sendMessage('crm_rules_get')로 받는다.
//
// 흐름:
//   1) startup/install/alarm → refresh() → HMAC GET /crm-definitions
//   2) 성공 → CRM_RULES_CACHE = { at, version, defs } 저장
//   3) 실패·미설정 → 번들 crm_definitions.json fallback (cold-start)
//
// 신규 CRM 도메인은 manifest content_scripts.matches가 빌드 시 박혀 있으므로,
// 이 모듈은 "이미 매칭되는 도메인"의 host_pattern·capture_paths·screen_patterns만 갱신한다.

import { getConfig } from './config.js';
import { buildHmacHeaders } from './hmac.js';
import { appendLog } from './error.js';

const CACHE_KEY = 'CRM_RULES_CACHE';
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

let _bundledPromise = null;

async function loadBundled() {
  if (_bundledPromise) return _bundledPromise;
  _bundledPromise = (async () => {
    const url = chrome.runtime.getURL('crm_definitions.json');
    const res = await fetch(url);
    return res.json();
  })();
  return _bundledPromise;
}

async function readCache() {
  const o = await chrome.storage.local.get(CACHE_KEY);
  return o[CACHE_KEY] || null;
}

async function writeCache(payload) {
  await chrome.storage.local.set({ [CACHE_KEY]: payload });
}

/**
 * 현재 사용할 CRM 테이블 반환.
 * 우선순위: chrome.storage 캐시 → 번들 JSON.
 * 호출자(background)는 결과를 그대로 content.js에 응답.
 */
export async function getTable() {
  const cached = await readCache();
  if (cached && cached.defs && Object.keys(cached.defs).length > 0) {
    return { source: 'remote', defs: cached.defs, version: cached.version, fetched_at: cached.at };
  }
  const bundled = await loadBundled();
  return { source: 'bundled', defs: bundled, version: 'bundled', fetched_at: null };
}

/**
 * 백엔드에서 최신 CRM 매트릭스 fetch → 캐시 갱신.
 * 미설정·실패 시 false 반환 (호출자가 fallback 처리).
 */
export async function refresh() {
  const cfg = await getConfig();
  if (!cfg.API_BASE || !cfg.API_KEY_ID || !cfg.HMAC_SECRET) {
    return false;
  }
  const path = '/crm-definitions';
  const url = `${cfg.API_BASE}${path}`;
  const body = '';

  try {
    const headers = await buildHmacHeaders({
      method: 'GET',
      path,
      body,
      secret: cfg.HMAC_SECRET,
      keyId: cfg.API_KEY_ID,
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      await appendLog({ level: 'warn', msg: 'crm_rules refresh non-200', status: res.status });
      return false;
    }
    const json = await res.json();
    if (!json || typeof json !== 'object' || !json.defs) {
      await appendLog({ level: 'warn', msg: 'crm_rules refresh malformed response' });
      return false;
    }
    await writeCache({
      at: new Date().toISOString(),
      version: json.version || 'unknown',
      defs: json.defs,
    });
    await appendLog({
      level: 'info',
      msg: 'crm_rules refreshed',
      version: json.version,
      count: Object.keys(json.defs).length,
    });
    return true;
  } catch (e) {
    await appendLog({ level: 'warn', msg: 'crm_rules refresh failed', err: String(e) });
    return false;
  }
}

export const CRM_REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MS;
