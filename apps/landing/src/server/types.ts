import type { LandingLogger } from "./landing/landing-logger";

export interface LandingWorkerBindings {
  // Local dev can intentionally omit the webhook binding and use the loopback
  // fallback sink, but deployed environments still require it.
  LANDING_SLACK_WEBHOOK_URL?: string;
}

export type LandingAppEnv = {
  Bindings: LandingWorkerBindings;
  Variables: {
    logger: LandingLogger;
    requestId: string;
  };
};
