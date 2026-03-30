import type { Database } from "@onequery/db/server";
import type { ServerStorage } from "@onequery/server/storage";
import { serverStorageMiddleware } from "@onequery/server/storage";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import type { AuthorizedCliOrgContext } from "./authorization";
import type { CliSessionIdentity } from "./domain/workflows";
import type { CliServerEnv } from "./env";
import { CLI_REQUEST_ID_HEADER, createCliProblemHandler } from "./error";
import {
  buildCliRequestLogDetails,
  getCliLogLevelForStatus,
  getIncomingCliRequestId,
  logCliEvent,
  toCliErrorMessage,
} from "./observability";

export type CliRouteEnv<
  Variables extends Record<string, unknown> = Record<string, never>,
> = {
  Bindings: CliServerEnv;
  Variables: {
    requestId: string;
    requestStartedAtMs: number;
    storage: ServerStorage;
  } & Variables;
};

export type CliSessionRouteVariables = {
  session: CliSessionIdentity;
};

export type CliOrgRouteVariables = CliSessionRouteVariables & {
  db: Database;
  authorizedOrg: AuthorizedCliOrgContext;
};

const cliRequestObservabilityMiddleware = createMiddleware<CliRouteEnv>(
  async (c, next) => {
    const existingRequestId = c.get("requestId");
    if (typeof existingRequestId === "string" && existingRequestId.length > 0) {
      await next();
      return;
    }

    // Comment: preserve an existing request ID when a parent app or test
    // harness has already bound one before the CLI middleware runs.
    const requestId =
      getIncomingCliRequestId(c.req.raw.headers) ?? crypto.randomUUID();
    const requestStartedAtMs = Date.now();
    c.set("requestId", requestId);
    c.set("requestStartedAtMs", requestStartedAtMs);

    logCliEvent({
      details: buildCliRequestLogDetails(c),
      event: "request.started",
      level: "info",
    });

    let thrownError: unknown = null;
    try {
      await next();
    } catch (error) {
      thrownError = error;
      throw error;
    } finally {
      c.header(CLI_REQUEST_ID_HEADER, requestId);

      if (thrownError) {
        logCliEvent({
          details: buildCliRequestLogDetails(c, {
            error: toCliErrorMessage(thrownError),
          }),
          event: "request.failed",
          level: "error",
        });
      } else {
        logCliEvent({
          details: buildCliRequestLogDetails(c, {
            status: c.res.status,
            durationMs: Math.max(0, Date.now() - requestStartedAtMs),
          }),
          event: "request.finished",
          level: getCliLogLevelForStatus(c.res.status),
        });
      }
    }
  }
);

function createCliRouter<
  Variables extends Record<string, unknown> = Record<string, never>,
>() {
  return new Hono<CliRouteEnv<Variables>>();
}

export function createCliApp<
  Variables extends Record<string, unknown> = Record<string, never>,
>() {
  const app = createCliRouter<Variables>();
  app.use(serverStorageMiddleware());
  app.use(cliRequestObservabilityMiddleware);
  app.onError(createCliProblemHandler());
  return app;
}

export function createCliBrowserApp<
  Variables extends Record<string, unknown> = Record<string, never>,
>() {
  const app = new Hono<CliRouteEnv<Variables>>();
  app.use(serverStorageMiddleware());
  app.use(cliRequestObservabilityMiddleware);
  return app;
}
