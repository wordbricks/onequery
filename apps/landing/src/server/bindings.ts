import { env } from "cloudflare:workers";

import type { WorkerBindings } from "./api";

export function readWorkerBindings(): WorkerBindings {
  return {
    LANDING_SLACK_WEBHOOK_URL:
      typeof env.LANDING_SLACK_WEBHOOK_URL === "string"
        ? env.LANDING_SLACK_WEBHOOK_URL
        : undefined,
  };
}
