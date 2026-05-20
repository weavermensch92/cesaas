// capture.js — boots a static server over the real PoC repo and drives
// Puppeteer to screenshot every surface (real implementation, not mockup).
// Writes PNGs into ./images/.

const http = require('http');
const fs   = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..', '..');   // hd-hyundai-poc/ (real repo root)
const PORT = 8765;
const OUT  = path.resolve(__dirname, 'images');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.ttf':  'font/ttf',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let p = path.join(ROOT, url);
      if (p.endsWith('/') || p.endsWith('\\')) p = path.join(p, 'index.html');
      if (!p.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
      fs.readFile(p, (err, buf) => {
        if (err) { res.statusCode = 404; return res.end('not found: ' + url); }
        const ext = path.extname(p).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(buf);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

/** Surfaces to capture.
 *  langSwitch: if set, the page has a <select id="langSel"> we drive to that value. */
const SHOTS = [
  // Real V_Voice surfaces — bilingual via langSel
  { id: 'voice-dealer_ru',    url: '/V_Voice/dealer/index.html',  w: 1180, h: 880, langSwitch: 'ru' },
  { id: 'voice-dealer_ko',    url: '/V_Voice/dealer/index.html',  w: 1180, h: 880, langSwitch: 'ko' },
  { id: 'voice-visitor_ru',   url: '/V_Voice/visitor/index.html', w: 430,  h: 900, langSwitch: 'ru', isMobile: true },
  { id: 'voice-visitor_ko',   url: '/V_Voice/visitor/index.html', w: 430,  h: 900, langSwitch: 'ko', isMobile: true },

  // _preview/ static mocks (Korean by default — these are HQ surfaces)
  { id: 'sensor-admin_ko',    url: '/_preview/admin-mock.html#captures',     w: 1440, h: 900 },
  { id: 'sensor-cluster_ko',  url: '/_preview/admin-mock.html#cluster',      w: 1440, h: 900 },
  { id: 'voice-admin_ko',     url: '/_preview/voice-admin-mock.html#responses',  w: 1440, h: 900 },
  { id: 'voice-aggregates_ko',url: '/_preview/voice-admin-mock.html#aggregates', w: 1440, h: 900 },
  { id: 'voice-studio_ko',    url: '/_preview/studio-mock.html',             w: 1440, h: 900 },
  { id: 'leads_ko',           url: '/_preview/leads-mock.html#list',         w: 1440, h: 900 },
  { id: 't08-verdict_ko',     url: '/_preview/t08-verdict-mock.html',        w: 1440, h: 900 },
  { id: 'extension-popup_ru', url: '/_preview/extension-popup.html',         w: 420,  h: 640 },
];

async function shoot(s) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
      await page.setViewport({
        width: s.w, height: s.h,
        deviceScaleFactor: 2,
        isMobile: !!s.isMobile,
        hasTouch: !!s.isMobile,
      });
      const url = `http://localhost:${PORT}${s.url}`;
      console.log(`→ ${s.id.padEnd(22)} [${s.w}×${s.h}]  ${s.url}`);
      // Seed localStorage to suppress first-visit onboarding overlays before scripts run.
      await page.evaluateOnNewDocument(() => {
        try {
          localStorage.setItem('hd_dealer_tutorial_seen_v1', '1');
          localStorage.setItem('hd_visitor_tutorial_seen_v1', '1');
        } catch (_) {}
      });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

      if (s.langSwitch) {
        const hasSel = await page.$('#langSel');
        if (hasSel) {
          await page.select('#langSel', s.langSwitch);
          await page.evaluate(() => {
            const el = document.getElementById('langSel');
            if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await new Promise(r => setTimeout(r, 400));
        }
      }

      await new Promise(r => setTimeout(r, 700));

    const file = path.join(OUT, `${s.id}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    console.log(`   ✓ ${path.basename(file)}  (${kb} KB)`);
    await page.close();
  } finally {
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  console.log(`static server :${PORT} → ${ROOT}`);
  try {
    for (const s of SHOTS) {
      // Retry once if Chrome hiccups (occasional CDP "Session not found" on Win).
      try { await shoot(s); }
      catch (e) {
        console.log(`   ! retry after error: ${e.message.split('\n')[0]}`);
        await new Promise(r => setTimeout(r, 1500));
        await shoot(s);
      }
    }
  } finally {
    srv.close();
  }
  console.log(`\nDone. Images in ${OUT}`);
})();
