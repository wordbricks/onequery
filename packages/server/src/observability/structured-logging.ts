import { structuredLogger } from "@hono/structured-logger";
import type { BaseLogger } from "@hono/structured-logger";
import type { Context, Env, MiddlewareHandler } from "hono";
import { requestId } from "hono/request-id";

export type { BaseLogger } from "@hono/structured-logger";
export type { RequestIdVariables } from "hono/request-id";

export type HonoStructuredLoggerVariables = {
  logger: BaseLogger;
};

export type HonoRequestLogLevel = "error" | "info" | "warn";

export type HonoRequestLogDetails = Record<string, unknown>;

export type HonoRequestLogEvents = {
  completed: string;
  failed: string;
  started: string;
};

export type HonoRequestLogMessages = {
  completed: string;
  failed: string;
  started: string;
};

export type HonoRequestIdOptions = NonNullable<Parameters<typeof requestId>[0]>;

export interface CreateHonoRequestStructuredLoggerOptions<TEnv extends Env> {
  buildErrorDetails?: (error: Error, c: Context<TEnv>) => HonoRequestLogDetails;
  buildRequestDetails?: (c: Context<TEnv>) => HonoRequestLogDetails;
  buildResponseDetails?: (
    c: Context<TEnv>,
    elapsedMs: number
  ) => HonoRequestLogDetails;
  events: HonoRequestLogEvents;
  getLogLevelForStatus?: (status: number) => HonoRequestLogLevel;
  messages: HonoRequestLogMessages;
  scope: string;
}

export function createRequestIdMiddleware(
  options: HonoRequestIdOptions = {}
): MiddlewareHandler {
  const fallbackGenerator = options.generator ?? (() => crypto.randomUUID());

  return requestId({
    ...options,
    generator: (c) => {
      const reqId = c.get("requestId");
      if (typeof reqId === "string" && reqId.length > 0) {
        return reqId;
      }

      return fallbackGenerator(c);
    },
  });
}

export function getHonoRequestLogLevelForStatus(
  status: number
): HonoRequestLogLevel {
  if (status >= 500) {
    return "error";
  }

  if (status >= 400) {
    return "warn";
  }

  return "info";
}

export function buildHonoRequestLogDetails<TEnv extends Env>(
  c: Context<TEnv>,
  extra: HonoRequestLogDetails = {}
): HonoRequestLogDetails {
  return {
    method: c.req.method,
    path: c.req.path,
    ...extra,
  };
}

export function createHonoRequestStructuredLogger<TEnv extends Env>(
  options: CreateHonoRequestStructuredLoggerOptions<TEnv>
): MiddlewareHandler<TEnv> {
  const buildRequestDetails =
    options.buildRequestDetails ?? buildHonoRequestLogDetails;
  const buildResponseDetails =
    options.buildResponseDetails ??
    ((c: Context<TEnv>, elapsedMs: number) => ({
      elapsedMs,
      status: c.res.status,
    }));
  const buildErrorDetails =
    options.buildErrorDetails ??
    ((error: Error, c: Context<TEnv>) => ({
      err: error,
      status: c.res.status,
    }));
  const getLogLevelForStatus =
    options.getLogLevelForStatus ?? getHonoRequestLogLevelForStatus;

  const middleware = structuredLogger({
    createLogger: () => console,
    onError: (logger, error, c) => {
      const context = c as Context<TEnv>;
      logger.error(
        {
          event: options.events.failed,
          scope: options.scope,
          ...buildRequestDetails(context),
          ...buildErrorDetails(error, context),
        },
        options.messages.failed
      );
    },
    onRequest: (logger, c) => {
      const context = c as Context<TEnv>;
      logger.info(
        {
          event: options.events.started,
          scope: options.scope,
          ...buildRequestDetails(context),
        },
        options.messages.started
      );
    },
    onResponse: (logger, c, elapsedMs) => {
      const context = c as Context<TEnv>;
      logger[getLogLevelForStatus(c.res.status)](
        {
          event: options.events.completed,
          scope: options.scope,
          ...buildRequestDetails(context),
          ...buildResponseDetails(context, elapsedMs),
        },
        options.messages.completed
      );
    },
  });

  return middleware as MiddlewareHandler<TEnv>;
}
