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

function createServiceUnavailableActionError(message: string) {
  return new ActionError({
    code: "SERVICE_UNAVAILABLE",
    message,
  });
}

function readWebhookUrl() {
  const webhookUrl = LANDING_SLACK_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    return webhookUrl;
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
}) {
  const webhookUrl = readWebhookUrl();

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
    handler: async ({ email }) => {
      await sendNotification({
        notificationType: "product_updates",
        payload: createProductUpdatesNotification(email),
      });

      return { email };
    },
  }),
  contact: defineAction({
    accept: "form",
    input: ContactInputSchema,
    handler: async (input) => {
      await sendNotification({
        notificationType: "contact",
        payload: createContactNotification(input),
      });

      return SENT_CONTACT;
    },
  }),
};
