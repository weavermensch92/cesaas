// QA probe — Voice dealer & visitor 단일 호출, 응답 본문 출력.
import { postDealer, postVisitor } from '../lib/voice-helpers.js';

async function main() {
  console.log('=== DEALER ===');
  const d = await postDealer({});
  console.log('  status:', d.status);
  console.log('  body:', JSON.stringify(d.bodyJson, null, 2));

  console.log('\n=== VISITOR ===');
  const v = await postVisitor({});
  console.log('  status:', v.status);
  console.log('  body:', JSON.stringify(v.bodyJson, null, 2));
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
