// build-tutorial.js — reads PNGs from ./images and writes self-contained
// HTML tutorials by inlining base64. Walks every *.template.html in this dir
// and writes ../<basename>.html.
const fs   = require('fs');
const path = require('path');

const IMG_DIR = path.resolve(__dirname, 'images');
const HERE    = __dirname;
const OUT_DIR = path.resolve(__dirname, '..');

const templates = fs.readdirSync(HERE).filter(f => f.endsWith('.template.html'));
if (!templates.length) {
  console.error('no *.template.html files found in', HERE);
  process.exit(1);
}

for (const tpl of templates) {
  const src = fs.readFileSync(path.join(HERE, tpl), 'utf8');
  const out = src.replace(/\{\{IMG:([a-z0-9_-]+)\}\}/g, (_, name) => {
    const file = path.join(IMG_DIR, `${name}.png`);
    if (!fs.existsSync(file)) {
      console.warn(`! missing image for template ${tpl}: ${name}.png`);
      return '';
    }
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  });
  const outName = tpl.replace(/\.template\.html$/, '.html');
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, out, 'utf8');
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`✓ ${outName.padEnd(20)} ${kb.padStart(6)} KB`);
}
