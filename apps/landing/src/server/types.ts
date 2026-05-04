import type { BaseLogger } from "@hono/structured-logger";
import type { RequestIdVariables } from "hono/request-id";

export interface LandingWorkerBindings {
  // Local dev can intentionally omit the webhook binding and use the loopback
  // fallback sink, but deployed environments still require it.
  LANDING_SLACK_WEBHOOK_URL?: string;
}

export type LandingAppEnv = {
  Bindings: LandingWorkerBindings;
  Variables: RequestIdVariables & {
    logger: BaseLogger;
  };
};
