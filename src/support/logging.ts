// Pino interface.
export interface LogFn {
  <T extends object>(obj: T, msg?: string, ...args: any[]): void;
  (obj: unknown, msg?: string, ...args: any[]): void;
  (msg: string, ...args: any[]): void;
}

export interface Logger {
  fatal: LogFn;
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
  trace: LogFn;
}

export const nullLogger = new (class implements Logger {
  fatal() {
    // Nothing
  }
  error() {
    // Nothing
  }
  warn() {
    // Nothing
  }
  info() {
    // Nothing
  }
  debug() {
    // Nothing
  }
  trace() {
    // Nothing
  }
})();
