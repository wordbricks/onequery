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
