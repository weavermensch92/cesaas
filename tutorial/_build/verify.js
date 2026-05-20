// verify.js — open tutorial.html in headless Chrome, screenshot top section,
// and assert all <img> elements have non-zero natural size.
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const FILES = ['tutorial.ko.html', 'tutorial.ru.html'];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  let bad = 0;
  for (const f of FILES) {
    const url = 'file:///' + path.resolve(__dirname, '..', f).replace(/\\/g, '/');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1800, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    const stats = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(i => ({
        alt: i.alt, w: i.naturalWidth, h: i.naturalHeight,
      }));
    });
    console.log(`\n${f} · images: ${stats.length}`);
    for (const s of stats) {
      const ok = s.w > 0 && s.h > 0;
      console.log(`  ${ok ? '✓' : '✗'} ${s.alt.padEnd(40)} ${s.w}×${s.h}`);
      if (!ok) bad++;
    }
    const png = path.resolve(__dirname, 'images', `_verify_${f.replace('.html','')}.png`);
    await page.screenshot({ path: png });
    console.log(`  preview: ${path.basename(png)}`);
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
