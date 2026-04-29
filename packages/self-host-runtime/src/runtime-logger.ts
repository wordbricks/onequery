import type { BaseLogger } from "@hono/structured-logger";
import pino from "pino/browser";

export type RuntimeLogger = BaseLogger;

type RuntimeLogRecord = {
  level?: string;
};

function writeRuntimeLog(record: RuntimeLogRecord) {
  switch (record.level) {
    case "error":
      console.error(record);
      return;
    case "warn":
      console.warn(record);
      return;
    case "debug":
      console.debug(record);
      return;
    default:
      console.info(record);
  }
}

const runtimeRootLogger = pino({
  browser: {
    asObject: true,
    formatters: {
      level: (level: string) => ({ level }),
    },
    // Comment: pino/browser captures console methods at construction time unless
    // routed through write, which makes test stubs miss request logs.
    write: writeRuntimeLog,
  },
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
}).child({
  service: "@onequery/self-host-runtime",
});

export function createRuntimeLogger(bindings: {
  method: string;
  path: string;
  requestId: string;
}): RuntimeLogger {
  return runtimeRootLogger.child(bindings);
}
