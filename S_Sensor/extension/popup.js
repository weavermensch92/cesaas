// popup.js — 자격증명 입력 + 큐 상태 + 로그 (Web Store 빌드)

import { getConfig, setConfig, clearConfig, isConfigured, decodeRegistrationCode } from './lib/config.js';
import { listAll } from './lib/queue.js';
import { readLogs, clearLogs } from './lib/error.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const configured = await isConfigured();
  $('setupSection').classList.toggle('hidden', configured);
  $('statusSection').classList.toggle('hidden', !configured);
  if (configured) {
    const cfg = await getConfig();
    $('cfgDealer').textContent = cfg.DEALER_ID;
    $('cfgKey').textContent = cfg.API_KEY_ID;
    $('cfgBase').textContent = cfg.API_BASE;
    await refreshQueue();
    await refreshLogs();
  }
}

async function refreshQueue() {
  try {
    const all = await listAll(500);
    $('qPending').textContent = all.filter((r) => r.status === 'pending').length;
    $('qSending').textContent = all.filter((r) => r.status === 'sending').length;
    $('qFailed').textContent  = all.filter((r) => r.status === 'failed').length;
    $('qDone').textContent    = all.filter((r) => r.status === 'done').length;
  } catch (_) { /* IDB 첫 부팅 — 무시 */ }
}

async function refreshLogs() {
  const logs = (await readLogs()).slice(-30).reverse();
  $('logs').innerHTML = logs.map((l) =>
    `<div class="lv-${l.level}">[${(l.ts || '').slice(11, 19)}] ${escapeHtml(l.msg || '')}</div>`
  ).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

$('saveCode').addEventListener('click', async () => {
  const code = $('codeInput').value;
  const errEl = $('setupErr');
  errEl.classList.add('hidden'); errEl.textContent = '';
  try {
    const decoded = decodeRegistrationCode(code);
    await setConfig(decoded);
    $('codeInput').value = '';
    await render();
  } catch (e) {
    errEl.textContent = e.message || String(e);
    errEl.classList.remove('hidden');
  }
});

$('drain').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'drain_now' });
  setTimeout(refreshQueue, 500);
});

$('exportLogs').addEventListener('click', async () => {
  const logs = await readLogs();
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.tabs.create({ url });
});

$('clearLogs').addEventListener('click', async () => {
  await clearLogs();
  refreshLogs();
});

$('resetConfig').addEventListener('click', async () => {
  if (!confirm('자격증명을 모두 초기화하시겠습니까?\n등록 코드를 다시 입력해야 합니다.')) return;
  await clearConfig();
  await render();
});

render();
setInterval(() => {
  if (!$('statusSection').classList.contains('hidden')) refreshQueue();
}, 3000);
