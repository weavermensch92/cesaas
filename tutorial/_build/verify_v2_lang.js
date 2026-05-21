// Boots local static server + drives puppeteer to confirm all three langs render.
const http = require('http');
const fs   = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8765;

const srv = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || p.endsWith('\\')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end(); }
    res.end(buf);
  });
});

srv.listen(PORT, async () => {
  const b = await puppeteer.launch({ headless: 'new' });
  try {
    for (const lang of ['ru', 'en', 'ko']) {
      const p = await b.newPage();
      await p.setViewport({ width: 1440, height: 900 });
      await p.goto(`http://localhost:${PORT}/V_Voice/dealer/v2/index.html`, { waitUntil: 'networkidle0' });
      await p.select('#langSel', lang);
      await new Promise(r => setTimeout(r, 600));
      const text = await p.evaluate(() => {
        const ids = ['surveyCrumb','queuePill','lbl_target_head','lbl_hypothesis','lbl_summary_head','lbl_radar_head','lbl_profile_head','lbl_interview','btnPrev','btnNext','btnSubmit','btnReset'];
        const o = {};
        for (const id of ids) { const el = document.getElementById(id); if (el) o[id] = el.textContent.trim(); }
        o.dealerCard = document.getElementById('dealerCard').textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
        return o;
      });
      console.log(`\n=== ${lang.toUpperCase()} ===`);
      for (const [k, v] of Object.entries(text)) console.log(`  ${k.padEnd(20)} ${v}`);
      await p.close();
    }
  } finally {
    await b.close();
    srv.close();
  }
});
