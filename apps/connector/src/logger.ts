type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LEVEL_PRIORITY = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
} as const;

export type Logger = {
  debug: (event: string, context?: LogContext) => void;
  info: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
  error: (event: string, context?: LogContext) => void;
};

export function createLogger(level: LogLevel): Logger {
  return {
    debug: (event, context) => writeLog("debug", level, event, context),
    error: (event, context) => writeLog("error", level, event, context),
    info: (event, context) => writeLog("info", level, event, context),
    warn: (event, context) => writeLog("warn", level, event, context),
  };
}

function writeLog(
  entryLevel: LogLevel,
  configuredLevel: LogLevel,
  event: string,
  context: LogContext | undefined
): void {
  if (LEVEL_PRIORITY[entryLevel] < LEVEL_PRIORITY[configuredLevel]) {
    return;
  }

  const payload = {
    event,
    level: entryLevel,
    timestamp: new Date().toISOString(),
    ...context,
  };

  const message = JSON.stringify(payload);
  if (entryLevel === "error") {
    console.error(message);
    return;
  }

  if (entryLevel === "warn") {
    console.warn(message);
    return;
  }

  console.log(message);
}
