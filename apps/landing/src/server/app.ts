import { structuredLogger } from "@hono/structured-logger";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import * as landingLogger from "./landing/landing-logger";
import type { LandingLogger } from "./landing/landing-logger";
import { landingRoute } from "./routes/landing";
import type { LandingInternalErrorResponse } from "./routes/landing/shared";
import type { LandingAppEnv } from "./types";

export type { LandingWorkerBindings } from "./types";
export type {
  LandingInternalErrorResponse,
  LandingProductUpdatesResponse,
  LandingServiceUnavailableErrorResponse,
} from "./routes/landing/shared";

export const landingApp = new Hono<LandingAppEnv>()
  .basePath("/api")
  .use("*", requestId())
  .use(
    "*",
    structuredLogger<LandingLogger>({
      createLogger: (c) =>
        landingLogger.createLandingLogger({
          method: c.req.method,
          path: c.req.path,
          requestId: c.var.requestId,
        }),
      onError: (logger, error, c) => {
        logger.error(
          {
            err: error,
            event: "landing.http.request_error",
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
          },
          "landing request error"
        );
      },
      onRequest: (logger, c) => {
        logger.info(
          {
            event: "landing.http.request_started",
            method: c.req.method,
            path: c.req.path,
          },
          "landing request start"
        );
      },
      onResponse: (logger, c, elapsedMs) => {
        logger.info(
          {
            elapsedMs,
            event: "landing.http.request_completed",
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
          },
          "landing request end"
        );
      },
    })
  )
  .onError((_error, c) =>
    c.json<LandingInternalErrorResponse, 500>(
      {
        code: "internal_error",
        message: "Internal server error",
      },
      500
    )
  )
  .route("/", landingRoute);

export type LandingApp = typeof landingApp;
