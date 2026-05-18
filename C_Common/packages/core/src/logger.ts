/**
 * 구조화 JSON 로깅 — C_06_로깅_메트릭.md.
 * Prometheus 메트릭은 별도 emitter (TODO: v1.1).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  request_id?: string;
  module?: string;
  hypothesis?: string[];
  err?: { name: string; message: string; stack?: string };
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  module?: string;
  baseFields?: Record<string, unknown>;
  /** Edge Function 등에서 sink 교체용. 기본 stdout JSON line. */
  sink?: (record: LogRecord) => void;
}

const ENV_LEVEL = (() => {
  const raw = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('LOG_LEVEL')
    ?? (typeof process !== 'undefined' ? process.env['LOG_LEVEL'] : undefined);
  if (raw && raw in LEVEL_ORDER) return raw as LogLevel;
  return 'info' as LogLevel;
})();

const defaultSink = (record: LogRecord): void => {
  const line = JSON.stringify(record);
  if (record.level === 'error' || record.level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
};

export class Logger {
  private readonly level: LogLevel;
  private readonly base: Record<string, unknown>;
  private readonly sink: (r: LogRecord) => void;

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? ENV_LEVEL;
    const baseFields = opts.baseFields ?? {};
    this.base = opts.module === undefined
      ? { ...baseFields }
      : { module: opts.module, ...baseFields };
    this.sink = opts.sink ?? defaultSink;
  }

  child(fields: Record<string, unknown>): Logger {
    return new Logger({
      level: this.level,
      baseFields: { ...this.base, ...fields },
      sink: this.sink,
    });
  }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...fields,
    };
    this.sink(record);
  }

  debug(msg: string, fields?: Record<string, unknown>): void { this.emit('debug', msg, fields); }
  info(msg: string, fields?: Record<string, unknown>): void { this.emit('info', msg, fields); }
  warn(msg: string, fields?: Record<string, unknown>): void { this.emit('warn', msg, fields); }
  error(msg: string, err?: unknown, fields?: Record<string, unknown>): void {
    const errPart = err instanceof Error
      ? { err: { name: err.name, message: err.message, stack: err.stack } }
      : err === undefined
        ? {}
        : { err: { name: 'NonError', message: String(err) } };
    this.emit('error', msg, { ...fields, ...errPart });
  }
}

export const logger = new Logger();

/**
 * 요청별 child 생성기 — request_id를 헤더에서 추출하거나 신규 발급.
 */
export function loggerForRequest(req: Request, parent: Logger = logger): Logger {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  return parent.child({ request_id: requestId });
}
