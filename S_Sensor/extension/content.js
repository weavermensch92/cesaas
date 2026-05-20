// content.js — URL 매칭 + 캡쳐 트리거 (S_10.02 · S_10.03).
// CRM 분류·entity 추출은 백엔드. 여기는 raw URL + raw 이미지만.
//
// CRM 매트릭스는 crm_definitions.json (data-driven — § 4.3 하드코드 지양).

import { collectMeta } from './lib/capture.js';
import { getConfig } from './lib/config.js';

const DEBOUNCE_MS = 1000;

let CRM_TABLE = null;
let CURRENT = null;
let captureTimer = null;
let lastUrl = location.href;

(async function init() {
  CRM_TABLE = await loadCrmTable();
  CURRENT = findMatchingCrm(location.href, CRM_TABLE);
  if (!CURRENT) return;

  observeNavigation();
  triggerCapture();
})();

async function loadCrmTable() {
  // crm_definitions.json은 web_accessible_resource. fetch로 로드.
  const url = chrome.runtime.getURL('crm_definitions.json');
  const res = await fetch(url);
  return res.json();
}

function findMatchingCrm(href, table) {
  for (const [crmId, def] of Object.entries(table)) {
    const re = new RegExp(def.host_pattern);
    if (re.test(href)) return { crmId, def };
  }
  return null;
}

function observeNavigation() {
  const origPush = history.pushState;
  history.pushState = function (...args) {
    origPush.apply(this, args);
    onUrlMaybeChanged();
  };
  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    onUrlMaybeChanged();
  };
  window.addEventListener('popstate', onUrlMaybeChanged);
}

function onUrlMaybeChanged() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  triggerCapture();
}

function triggerCapture() {
  if (!CURRENT) return;
  if (!pathMatchesCapturePaths(CURRENT.def, location.pathname)) return;

  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    const cfg = await getConfig();
    if (!cfg.DEALER_ID) {
      console.warn('[Gridge] capture skipped — extension not configured');
      return;
    }
    const meta = collectMeta({ crmId: CURRENT.crmId, dealerId: cfg.DEALER_ID });
    try {
      await chrome.runtime.sendMessage({ type: 'capture_request', meta });
    } catch (e) {
      console.warn('[Gridge] capture_request failed', e);
    }
  }, DEBOUNCE_MS);
}

function pathMatchesCapturePaths(def, pathname) {
  const paths = def.capture_paths ?? ['/'];
  return paths.some((p) => pathname.startsWith(p));
}
