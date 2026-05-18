// 구조화 JSON 로깅 — C_06.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldEmit(level: LogLevel): boolean {
  const env = Deno.env.get('LOG_LEVEL');
  const threshold = (env && env in ORDER ? env : 'info') as LogLevel;
  return ORDER[level] >= ORDER[threshold];
}

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  if (!shouldEmit(level)) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(), level, msg, ...fields,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export function requestLogger(req: Request, baseFields: Record<string, unknown> = {}) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const ctx = { request_id: requestId, ...baseFields };
  return {
    requestId,
    debug: (m: string, f?: Record<string, unknown>) => log('debug', m, { ...ctx, ...f }),
    info:  (m: string, f?: Record<string, unknown>) => log('info',  m, { ...ctx, ...f }),
    warn:  (m: string, f?: Record<string, unknown>) => log('warn',  m, { ...ctx, ...f }),
    error: (m: string, err?: unknown, f?: Record<string, unknown>) => {
      const errPart = err instanceof Error
        ? { err: { name: err.name, message: err.message, stack: err.stack } }
        : err === undefined ? {} : { err: { name: 'NonError', message: String(err) } };
      log('error', m, { ...ctx, ...f, ...errPart });
    },
  };
}
