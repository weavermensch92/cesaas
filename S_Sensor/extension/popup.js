// popup.js — 큐 상태·재시도·로그 export (S_10.06 § 4).

import { CONFIG } from './config.js';
import { listAll, count } from './lib/queue.js';
import { readLogs, clearLogs } from './lib/error.js';

const $ = (id) => document.getElementById(id);

async function refresh() {
  $('dealer').textContent = CONFIG.DEALER_ID;
  const all = await listAll(500);
  $('pending').textContent = all.filter((r) => r.status === 'pending' || r.status === 'sending').length;
  $('failed').textContent = all.filter((r) => r.status === 'failed').length;
  $('done').textContent = all.filter((r) => r.status === 'done').length;

  const logs = (await readLogs()).slice(-30).reverse();
  $('logs').innerHTML = logs
    .map((l) => `<div class="lv-${l.level}">[${l.ts.slice(11, 19)}] ${escapeHtml(l.msg)}</div>`)
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

$('drain').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'drain_now' });
  setTimeout(refresh, 500);
});

$('export').addEventListener('click', async () => {
  const logs = await readLogs();
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  // downloads 권한 없이 — 새 탭에서 직접 열기.
  await chrome.tabs.create({ url });
});

$('clear').addEventListener('click', async () => {
  await clearLogs();
  refresh();
});

refresh();
setInterval(refresh, 3000);
