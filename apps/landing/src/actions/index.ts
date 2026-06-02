import { z } from "astro/zod";
import { ActionError, defineAction } from "astro:actions";
import { LANDING_SLACK_WEBHOOK_URL } from "astro:env/server";

import {
  createContactNotification,
  createProductUpdatesNotification,
  deliverSlackNotification,
} from "@/server/notifications";
import type {
  NotificationType,
  SlackNotificationPayload,
} from "@/server/notifications";

const EmailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.email({ pattern: z.regexes.html5Email })
);

const ProductUpdatesInputSchema = z.object({
  email: EmailSchema,
});

const ContactInputSchema = z.object({
  email: EmailSchema,
  message: z.string().trim().min(1, "message is required").max(4000),
  name: z.string().trim().min(1, "name is required").max(200),
});

const SENT_CONTACT = {
  status: "sent",
} as const;

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function createServiceUnavailableActionError(message: string) {
  return new ActionError({
    code: "SERVICE_UNAVAILABLE",
    message,
  });
}

function readWebhookUrl(request: Request) {
  const webhookUrl = LANDING_SLACK_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    return webhookUrl;
  }

  if (isLoopbackHostname(new URL(request.url).hostname)) {
    return undefined;
  }

  console.error(
    {
      event: "landing.notification.delivery_unconfigured",
    },
    "landing notification delivery is unconfigured"
  );
  throw createServiceUnavailableActionError("Landing ingest is not configured");
}

async function sendNotification(input: {
  notificationType: NotificationType;
  payload: SlackNotificationPayload;
  request: Request;
}) {
  const webhookUrl = readWebhookUrl(input.request);
  if (!webhookUrl) {
    console.info(
      {
        event: "landing.notification.delivered_local",
        notificationType: input.notificationType,
      },
      "landing notification routed to local sink"
    );
    return;
  }

  try {
    await deliverSlackNotification({
      notificationType: input.notificationType,
      payload: input.payload,
      webhookUrl,
    });
  } catch (error) {
    console.error(
      {
        error,
        event: "landing.notification.action_failed",
        notificationType: input.notificationType,
      },
      "landing notification action failed"
    );
    throw createServiceUnavailableActionError("Failed to deliver notification");
  }
}

export const server = {
  productUpdates: defineAction({
    accept: "form",
    input: ProductUpdatesInputSchema,
    handler: async ({ email }, { request }) => {
      await sendNotification({
        notificationType: "product_updates",
        payload: createProductUpdatesNotification(email),
        request,
      });

      return { email };
    },
  }),
  contact: defineAction({
    accept: "form",
    input: ContactInputSchema,
    handler: async (input, { request }) => {
      await sendNotification({
        notificationType: "contact",
        payload: createContactNotification(input),
        request,
      });

      return SENT_CONTACT;
    },
  }),
};
