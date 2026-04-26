import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import type { Database } from "@onequery/db/server";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import type { ServerStorage } from "@onequery/server/storage";
import { serverStorageMiddleware } from "@onequery/server/storage";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { requestId as requestIdMiddleware } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";

import type { AuthorizedCliOrgContext } from "./authorization";
import type { CliSessionIdentity } from "./domain/workflows";
import {
  buildCliRequestLogDetails,
  getCliLogLevelForStatus,
  logCliEvent,
  toCliErrorMessage,
} from "./observability";
import { CLI_REQUEST_ID_HEADER } from "./request-context";

export type HonoNodeBindings = HttpBindings | Http2Bindings;

export type CliRouteEnv<
  Variables extends Record<string, unknown> = Record<string, never>,
> = {
  Bindings: HonoNodeBindings;
  Variables: RequestIdVariables & {
    requestStartedAtMs: number;
    runtime: ServerRuntimeConfig;
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

export interface CreateCliAppOptions {
  runtime: ServerRuntimeConfig;
  storage: ServerStorage;
}

const cliRequestObservabilityMiddleware = createMiddleware<CliRouteEnv>(
  async (c, next) => {
    const requestStartedAtMs = Date.now();
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

function cliRuntimeMiddleware<
  Variables extends Record<string, unknown> = Record<string, never>,
>(runtime: ServerRuntimeConfig) {
  return createMiddleware<{
    Variables: { runtime: ServerRuntimeConfig } & Variables;
  }>(async (c, next) => {
    (
      c as typeof c & {
        set: (key: "runtime", value: ServerRuntimeConfig) => void;
      }
    ).set("runtime", runtime);
    await next();
  });
}

function createCliRouter<
  Variables extends Record<string, unknown> = Record<string, never>,
>() {
  return new Hono<CliRouteEnv<Variables>>().notFound((c) =>
    c.text("404 Not Found", 404)
  );
}

export function createCliApp<
  Variables extends Record<string, unknown> = Record<string, never>,
>(input: CreateCliAppOptions) {
  const app = createCliRouter<Variables>();
  app.use(cliRuntimeMiddleware(input.runtime));
  app.use(serverStorageMiddleware(input.storage));
  app.use(
    requestIdMiddleware({
      headerName: CLI_REQUEST_ID_HEADER,
    })
  );
  app.use(cliRequestObservabilityMiddleware);
  return app;
}

export function createCliBrowserApp<
  Variables extends Record<string, unknown> = Record<string, never>,
>(input: CreateCliAppOptions) {
  const app = createCliRouter<Variables>();
  app.use(cliRuntimeMiddleware(input.runtime));
  app.use(serverStorageMiddleware(input.storage));
  app.use(
    requestIdMiddleware({
      headerName: CLI_REQUEST_ID_HEADER,
    })
  );
  app.use(cliRequestObservabilityMiddleware);
  return app;
}
