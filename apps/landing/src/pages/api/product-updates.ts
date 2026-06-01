import type { APIRoute } from "astro";
import { LANDING_SLACK_WEBHOOK_URL } from "astro:env/server";

import { handleProductUpdatesRequest } from "@/server/api";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  handleProductUpdatesRequest({
    request,
    slackWebhookUrl: LANDING_SLACK_WEBHOOK_URL,
  });
