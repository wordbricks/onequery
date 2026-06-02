import { ActionError, defineAction } from "astro:actions";
import { LANDING_SLACK_WEBHOOK_URL } from "astro:env/server";

import { submitContactLead, submitProductUpdatesLead } from "@/server/api";
import type { ProductUpdatesResponse } from "@/server/api";
import { NotificationConfigurationError } from "@/server/notifications";
import type { NotificationError } from "@/server/notifications";
import {
  ContactRequestSchema,
  ProductUpdatesRequestSchema,
} from "@/server/schemas";

type ContactActionState = {
  status: "sent";
};

const SENT_CONTACT_ACTION_STATE = {
  status: "sent",
} satisfies ContactActionState;

function createActionError(error: NotificationError) {
  const message = NotificationConfigurationError.is(error)
    ? error.message
    : "Failed to deliver notification";

  return new ActionError({
    code: "SERVICE_UNAVAILABLE",
    message,
  });
}

export const server = {
  productUpdates: defineAction({
    accept: "form",
    input: ProductUpdatesRequestSchema,
    handler: async (input, { request }): Promise<ProductUpdatesResponse> => {
      const result = await submitProductUpdatesLead(input, {
        request,
        slackWebhookUrl: LANDING_SLACK_WEBHOOK_URL,
      });

      if (result.isErr()) {
        throw createActionError(result.error);
      }

      return result.value;
    },
  }),
  contact: defineAction({
    accept: "form",
    input: ContactRequestSchema,
    handler: async (input, { request }): Promise<ContactActionState> => {
      const result = await submitContactLead(input, {
        request,
        slackWebhookUrl: LANDING_SLACK_WEBHOOK_URL,
      });

      if (result.isErr()) {
        throw createActionError(result.error);
      }

      return SENT_CONTACT_ACTION_STATE;
    },
  }),
};
