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

function getLandingRequestLogMethod(logger: LandingLogger, status: number) {
  if (status >= 500) {
    return logger.error.bind(logger);
  }

  if (status >= 400) {
    return logger.warn.bind(logger);
  }

  return logger.info.bind(logger);
}

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
            event: "request.failed",
            status: c.res.status,
          },
          "request failed"
        );
      },
      onRequest: () => {},
      onResponse: (logger, c, elapsedMs) => {
        const log = getLandingRequestLogMethod(logger, c.res.status);

        log(
          {
            durationMs: Math.max(0, Math.round(elapsedMs)),
            event: "request.finished",
            status: c.res.status,
          },
          "request finished"
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
