// run-all.ts 가 Worker로 시나리오 스크립트를 실행할 때 사용하는 launcher.
//
// 역할:
//   1) 자식 시나리오의 process.exit() 호출을 가로채 throw 로 변환.
//      → supabase-js keep-alive 소켓이 native cleanup 단계에서 segfault 내는 걸 회피.
//   2) 캡쳐한 exit code 를 parentPort 로 메인 스레드에 전달.
//
// run-all.ts 의 Worker.on('exit') 자체 code 는 worker 종료 직후 환경(Windows + Node)에서
// 부정확할 수 있어 message-based 캡쳐를 권장 경로로 사용.

import { workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

let capturedExit = 0;

const originalExit = process.exit.bind(process);
(process as unknown as { exit: (code?: number) => never }).exit = (code: number = 0): never => {
  capturedExit = code ?? 0;
  parentPort?.postMessage({ exitCode: capturedExit });
  // Worker 모듈 흐름을 강제 종료 — silent symbol 로 main 의 catch handler 가 통과시키게.
  const e = new Error(`__t_test_exit__${capturedExit}`) as Error & { __t_test_silent?: true };
  e.__t_test_silent = true;
  throw e;
};

async function run(): Promise<void> {
  const scriptPath = workerData?.scriptPath as string | undefined;
  if (!scriptPath) {
    parentPort?.postMessage({ exitCode: 2, reason: 'no scriptPath' });
    return;
  }
  try {
    // Windows 호환 — absolute path 를 file:// URL 로 변환.
    await import(pathToFileURL(scriptPath).href);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.startsWith('__t_test_exit__')) {
      console.error('worker uncaught:', e);
      capturedExit = 2;
    }
  }
  parentPort?.postMessage({ exitCode: capturedExit });
  // process.exit 패치돼 있으므로 그냥 함수 끝 — Worker는 module/microtask 큐 비면 자연 종료.
  // 다만 keep-alive 핸들이 남으면 종료 안 됨. 그 경우 메인 스레드가 terminate 호출.
  void originalExit;
}

void run();
