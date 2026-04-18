import { create } from "@bufbuild/protobuf";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { Code, ConnectError, createContextKey } from "@connectrpc/connect";

import {
  LandingService,
  SubmitContactResponseSchema,
  SubscribeProductUpdatesResponseSchema,
} from "../connect/gen/onequery/landing/v1/landing_pb.js";

export const LEAD_CAPTURE_SOURCE = "onequery_landing";

export interface LandingServiceContext {
  slackWebhookUrl: string | null;
}

export const landingContextKey = createContextKey<LandingServiceContext>({
  slackWebhookUrl: null,
});

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function postToSlack(
  slackWebhookUrl: string | null,
  payload: Record<string, unknown>
) {
  if (!slackWebhookUrl) {
    throw new ConnectError(
      "Landing ingest is not configured",
      Code.Unavailable
    );
  }

  const response = await fetch(slackWebhookUrl, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (response.ok) {
    return;
  }

  const upstream = await response.text().catch(() => "");
  // Comment: public lead-capture requests should not leak upstream webhook
  // details back to the browser, so worker errors stay generic.
  console.error("[landing-service] slack webhook error", {
    message: upstream.slice(0, 500),
    status: response.status,
  });
  throw new ConnectError("Failed to deliver notification", Code.Unavailable);
}

const landingServiceImpl: ServiceImpl<typeof LandingService> = {
  async subscribeProductUpdates(request, ctx) {
    const email = request.email.trim().toLowerCase();
    const { slackWebhookUrl } = ctx.values.get(landingContextKey);
    await postToSlack(slackWebhookUrl, {
      text: `New product updates signup: ${email}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "New product updates signup" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Email*\n${escapeSlackText(email)}` },
            { type: "mrkdwn", text: `*Source*\n${LEAD_CAPTURE_SOURCE}` },
          ],
        },
      ],
    });
    return create(SubscribeProductUpdatesResponseSchema, { email });
  },

  async submitContact(request, ctx) {
    const email = request.email.trim().toLowerCase();
    const name = request.name.trim();
    const message = request.message.trim();
    const { slackWebhookUrl } = ctx.values.get(landingContextKey);
    await postToSlack(slackWebhookUrl, {
      text: `New contact request from ${name} (${email})`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "New contact request" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Name*\n${escapeSlackText(name)}` },
            { type: "mrkdwn", text: `*Email*\n${escapeSlackText(email)}` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Message*\n${escapeSlackText(message)}`,
          },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `Source: ${LEAD_CAPTURE_SOURCE}` },
          ],
        },
      ],
    });
    return create(SubmitContactResponseSchema, {});
  },
};

export function registerLandingRoutes(router: ConnectRouter) {
  router.service(LandingService, landingServiceImpl);
}
