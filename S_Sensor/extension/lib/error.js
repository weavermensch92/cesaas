// lib/error.js — 에러 분류·로깅 (S_10.06).
// background.js · content.js 공통.

export const ErrorCategory = {
  CAPTURE: 'capture',
  CHUNK: 'chunk',
  SIGN: 'sign',
  NETWORK: 'network',
  SERVER_4XX: 'server_4xx',
  SERVER_5XX: 'server_5xx',
  QUEUE: 'queue',
  UNKNOWN: 'unknown',
};

const LOG_LIMIT = 200;

export function classifyHttp(status) {
  if (status >= 200 && status < 300) return null;
  if (status === 429) return ErrorCategory.SERVER_5XX; // throttle도 재시도
  if (status >= 500) return ErrorCategory.SERVER_5XX;
  if (status >= 400) return ErrorCategory.SERVER_4XX;
  return ErrorCategory.UNKNOWN;
}

export async function appendLog(entry) {
  try {
    const { gridge_logs: existing = [] } = await chrome.storage.local.get('gridge_logs');
    const next = [
      ...existing,
      { ts: new Date().toISOString(), ...entry },
    ].slice(-LOG_LIMIT);
    await chrome.storage.local.set({ gridge_logs: next });
  } catch (e) {
    // storage 자체가 안 되면 console만.
    console.warn('[Gridge] log persist failed', e);
  }
  if (entry.level === 'error') {
    console.error('[Gridge]', entry.msg, entry);
  } else {
    console.log('[Gridge]', entry.msg, entry);
  }
}

export async function readLogs() {
  const { gridge_logs: existing = [] } = await chrome.storage.local.get('gridge_logs');
  return existing;
}

export async function clearLogs() {
  await chrome.storage.local.remove('gridge_logs');
}
