import type { BaseLogger } from "@hono/structured-logger";
import pino from "pino/browser";

export type LandingLogger = BaseLogger;

const landingRootLogger = pino({
  browser: {
    asObject: true,
    formatters: {
      level: (level: string) => ({ level }),
    },
  },
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
}).child({
  service: "@onequery/landing",
});

export function createLandingLogger(bindings: {
  method: string;
  path: string;
  requestId: string;
}): LandingLogger {
  return landingRootLogger.child(bindings);
}
