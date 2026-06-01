import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

import { handleProductUpdatesRequest } from "@/server/api";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  handleProductUpdatesRequest({
    bindings: {
      LANDING_SLACK_WEBHOOK_URL:
        typeof env.LANDING_SLACK_WEBHOOK_URL === "string"
          ? env.LANDING_SLACK_WEBHOOK_URL
          : undefined,
    },
    request,
  });
