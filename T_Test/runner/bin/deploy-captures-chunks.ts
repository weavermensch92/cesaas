// QA — captures-chunks Edge Function을 Management API로 재배포.
// shared/* 모듈도 함께 multipart로 업로드.
//
// API: POST /v1/projects/{ref}/functions/deploy?slug=captures-chunks
//      multipart/form-data: metadata + file[]
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;

if (!TOKEN || !REF) { console.error('TOKEN/REF missing'); process.exit(1); }

const ROOT = resolve(process.cwd(), 'S_Sensor/backend');
const SHARED = resolve(ROOT, 'shared');

// captures-chunks/index.ts 가 import하는 shared 모듈 파일들
const SHARED_FILES = ['hmac.ts', 'idempotency.ts', 'errors.ts', 'hash.ts', 'db.ts', 'env.ts', 'logger.ts'];

async function loadAsBlob(absPath: string, name: string): Promise<File> {
  const buf = await readFile(absPath);
  return new File([buf], name, { type: 'application/typescript' });
}

async function main() {
  // Files: index.ts + shared/* + deno.json
  const indexPath = resolve(ROOT, 'functions/captures-chunks/index.ts');
  const denoJsonPath = resolve(ROOT, 'deno.json');
  const files: File[] = [];
  files.push(await loadAsBlob(indexPath, 'index.ts'));
  files.push(await loadAsBlob(denoJsonPath, 'deno.json'));
  for (const f of SHARED_FILES) {
    const p = resolve(SHARED, f);
    files.push(await loadAsBlob(p, `shared/${f}`));
  }
  console.log('files:', files.map((f) => f.name));

  const fd = new FormData();
  fd.append('metadata', JSON.stringify({
    name: 'captures-chunks',
    verify_jwt: false,
    entrypoint_path: 'index.ts',
    import_map_path: 'deno.json',
  }));
  for (const f of files) fd.append('file', f, f.name);

  const url = `https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=captures-chunks`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  const text = await r.text();
  console.log('HTTP', r.status);
  console.log(text.slice(0, 2000));
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
