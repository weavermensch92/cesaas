// background.js — service worker.
// captureVisibleTab(WebP) → queue enqueue → drain loop.

import { CONFIG } from './config.js';
import { enqueue, popPending, updateStatus, trim } from './lib/queue.js';
import { sendCapture } from './lib/sender.js';
import { estimateKb, pickFallbackQuality } from './lib/capture.js';
import { appendLog } from './lib/error.js';

const DRAIN_INTERVAL_MS = 5 * 60 * 1000;
const TRIM_INTERVAL_MS  = 30 * 60 * 1000;
const INITIAL_QUALITY   = 85;
const MAX_KB            = 500;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'capture_request') {
    handleCaptureRequest(msg.meta, sender)
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
  if (msg.type === 'drain_now') {
    drainQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

async function handleCaptureRequest(meta, sender) {
  const windowId = sender?.tab?.windowId;
  if (windowId == null) return { ok: false, error: 'no_window' };

  let quality = INITIAL_QUALITY;
  let dataUrl = await captureWebP(windowId, quality);
  let sizeKb = estimateKb(dataUrl);

  while (true) {
    const next = pickFallbackQuality(sizeKb, quality);
    if (next == null) break;
    quality = next;
    dataUrl = await captureWebP(windowId, quality);
    sizeKb = estimateKb(dataUrl);
  }

  const id = await enqueue({
    captured_at: meta.captured_at,
    meta,
    data_url: dataUrl,
    size_bytes: sizeKb * 1024,
    quality,
  });
  await appendLog({ level: 'info', msg: 'capture enqueued', id, size_kb: sizeKb, quality });

  // 즉시 drain 시도 (실패해도 다음 주기 drain 처리)
  drainQueue().catch((e) => appendLog({ level: 'warn', msg: 'drain after enqueue failed', err: String(e) }));
  return { ok: true, id };
}

function captureWebP(windowId, quality) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      windowId,
      { format: 'webp', quality },
      (dataUrl) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else if (!dataUrl) reject(new Error('empty dataUrl'));
        else resolve(dataUrl);
      }
    );
  });
}

async function drainQueue() {
  // 단일 워커 가정. 동시 호출은 큐 lock 없이 IDB 순차로 처리.
  while (true) {
    const items = await popPending(1);
    if (items.length === 0) return;
    const item = items[0];

    await updateStatus(item.id, 'sending');
    const result = await sendCapture(item);

    if (result.ok) {
      await updateStatus(item.id, 'done');
    } else {
      const failed = result.attempts >= 8;
      await updateStatus(item.id, failed ? 'failed' : 'pending', { last_error: result.reason });
      if (!failed) {
        // 무한 루프 방지 — pending 상태로 두고 다음 drain 주기에 다시 시도.
        return;
      }
    }
  }
}

// online 시 자동 drain
self.addEventListener('online', () => {
  appendLog({ level: 'info', msg: 'online — drain' });
  drainQueue().catch(() => {});
});

// 주기 drain·trim — chrome.alarms로 service worker 깨우기
chrome.alarms.create('drain', { periodInMinutes: DRAIN_INTERVAL_MS / 60000 });
chrome.alarms.create('trim', { periodInMinutes: TRIM_INTERVAL_MS / 60000 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'drain') drainQueue().catch(() => {});
  if (alarm.name === 'trim') trim().catch(() => {});
});

// 시작 시 1회
drainQueue().catch(() => {});
