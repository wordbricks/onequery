import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import type { Database } from "@onequery/db/server";
import { createHonoRequestStructuredLogger } from "@onequery/server/observability/structured-logging";
import type { HonoStructuredLoggerVariables } from "@onequery/server/observability/structured-logging";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import type { ServerStorage } from "@onequery/server/storage";
import { serverStorageMiddleware } from "@onequery/server/storage";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";

import type { AuthorizedCliOrgContext } from "./authorization";
import type { CliSessionIdentity } from "./domain/workflows";
import {
  buildCliRequestLogDetails,
  getCliLogLevelForStatus,
  toCliErrorMessage,
} from "./observability";
import { CLI_REQUEST_ID_HEADER } from "./request-context";

export type HonoNodeBindings = HttpBindings | Http2Bindings;

export type CliRouteEnv<
  Variables extends Record<string, unknown> = Record<string, never>,
> = {
  Bindings: HonoNodeBindings;
  Variables: RequestIdVariables & {
    runtime: ServerRuntimeConfig;
    storage: ServerStorage;
  } & HonoStructuredLoggerVariables &
    Variables;
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

const cliRequestStructuredLoggerMiddleware =
  createHonoRequestStructuredLogger<CliRouteEnv>({
    buildErrorDetails: (error, c) => ({
      error: toCliErrorMessage(error),
      status: c.res.status,
    }),
    buildRequestDetails: buildCliRequestLogDetails,
    buildResponseDetails: (c, elapsedMs) => ({
      durationMs: Math.max(0, Math.trunc(elapsedMs)),
      status: c.res.status,
    }),
    events: {
      completed: "request.finished",
      failed: "request.failed",
      started: "request.started",
    },
    getLogLevelForStatus: getCliLogLevelForStatus,
    messages: {
      completed: "cli request finished",
      failed: "cli request failed",
      started: "cli request started",
    },
    scope: "cli",
  });

function cliRuntimeMiddleware(runtime: ServerRuntimeConfig) {
  return createMiddleware<{
    Variables: {
      runtime: ServerRuntimeConfig;
    };
  }>(async (c, next) => {
    c.set("runtime", runtime);
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

function applyCliRouteMiddleware<
  Variables extends Record<string, unknown> = Record<string, never>,
>(app: Hono<CliRouteEnv<Variables>>, input: CreateCliAppOptions) {
  app.use(cliRequestStructuredLoggerMiddleware);
  app.use(cliRuntimeMiddleware(input.runtime));
  app.use(serverStorageMiddleware(input.storage));
  return app;
}

export function createCliRoutes<
  Variables extends Record<string, unknown> = Record<string, never>,
>(input: CreateCliAppOptions) {
  const app = createCliRouter<Variables>();
  return applyCliRouteMiddleware(app, input);
}

export function createCliBrowserRoutes<
  Variables extends Record<string, unknown> = Record<string, never>,
>(input: CreateCliAppOptions) {
  const app = createCliRouter<Variables>();
  return applyCliRouteMiddleware(app, input);
}

export function createCliApp<
  Variables extends Record<string, unknown> = Record<string, never>,
>(input: CreateCliAppOptions) {
  const app = createCliRouter<Variables>();
  app.use(
    requestId({
      headerName: CLI_REQUEST_ID_HEADER,
    })
  );
  return applyCliRouteMiddleware(app, input);
}

export function createCliBrowserApp<
  Variables extends Record<string, unknown> = Record<string, never>,
>(input: CreateCliAppOptions) {
  const app = createCliRouter<Variables>();
  app.use(
    requestId({
      headerName: CLI_REQUEST_ID_HEADER,
    })
  );
  return applyCliRouteMiddleware(app, input);
}
