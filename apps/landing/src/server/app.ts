import { structuredLogger } from "@hono/structured-logger";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { landingRoute } from "./routes/landing";
import type { LandingInternalErrorResponse } from "./routes/landing/shared";
import type { LandingAppEnv } from "./types";

export type { LandingWorkerBindings } from "./types";
export type {
  LandingInternalErrorResponse,
  LandingProductUpdatesResponse,
  LandingServiceUnavailableErrorResponse,
  LandingValidationErrorResponse,
} from "./routes/landing/shared";

export const landingApp = new Hono<LandingAppEnv>()
  .basePath("/api")
  .use("*", requestId())
  .use(
    "*",
    structuredLogger({
      createLogger: () => console,
      onRequest: (logger, c) => {
        logger.info(
          {
            event: "landing.request.started",
            method: c.req.method,
            path: c.req.path,
            requestId: c.get("requestId"),
          },
          "landing request started"
        );
      },
      onResponse: (logger, c, elapsedMs) => {
        logger.info(
          {
            elapsedMs,
            event: "landing.request.completed",
            method: c.req.method,
            path: c.req.path,
            requestId: c.get("requestId"),
            status: c.res.status,
          },
          "landing request completed"
        );
      },
      onError: (logger, error, c) => {
        logger.error(
          {
            err: error,
            event: "landing.request.failed",
            method: c.req.method,
            path: c.req.path,
            requestId: c.get("requestId"),
            status: c.res.status,
          },
          "landing request failed"
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
