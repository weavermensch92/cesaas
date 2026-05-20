// lib/config.js — chrome.storage 기반 자격증명 관리 (Web Store 빌드).
// 등록 코드 = base64-encoded JSON { API_BASE, API_KEY_ID, HMAC_SECRET, DEALER_ID }
// 어드민 /dealers 에서 발급 → 딜러가 popup 에 붙여넣기 → chrome.storage.local 저장.

const KEYS = ['API_BASE', 'API_KEY_ID', 'HMAC_SECRET', 'DEALER_ID', 'DEBUG'];
let _cache = null;
let _cacheAt = 0;
const TTL_MS = 30_000;

export async function getConfig() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < TTL_MS) return _cache;
  const stored = await chrome.storage.local.get(KEYS);
  _cache = {
    API_BASE:    stored.API_BASE    || '',
    API_KEY_ID:  stored.API_KEY_ID  || '',
    HMAC_SECRET: stored.HMAC_SECRET || '',
    DEALER_ID:   stored.DEALER_ID   || '',
    DEBUG:       Boolean(stored.DEBUG),
  };
  _cacheAt = now;
  return _cache;
}

export async function setConfig(values) {
  const patch = {};
  for (const k of KEYS) if (k in values) patch[k] = values[k];
  await chrome.storage.local.set(patch);
  _cache = null;
}

export async function clearConfig() {
  await chrome.storage.local.remove(KEYS);
  _cache = null;
}

export async function isConfigured() {
  const c = await getConfig();
  return !!(c.API_BASE && c.API_KEY_ID && c.HMAC_SECRET && c.DEALER_ID);
}

/**
 * 등록 코드 (base64-url JSON) 를 디코드 + 검증.
 * Throws on invalid input.
 */
export function decodeRegistrationCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('등록 코드가 비어있습니다');
  }
  // base64url → base64
  const normalized = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  let json;
  try {
    json = atob(normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '='));
  } catch (e) {
    throw new Error('등록 코드 디코드 실패 (base64 형식 아님)');
  }
  let obj;
  try { obj = JSON.parse(json); } catch (e) {
    throw new Error('등록 코드 JSON 파싱 실패');
  }
  for (const k of ['API_BASE', 'API_KEY_ID', 'HMAC_SECRET', 'DEALER_ID']) {
    if (!obj[k] || typeof obj[k] !== 'string') {
      throw new Error(`등록 코드 필수 필드 누락: ${k}`);
    }
  }
  return obj;
}

// 외부 변경 감지 → 캐시 무효화
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') _cache = null;
  });
}
