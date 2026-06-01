import { ActionError, defineAction } from "astro:actions";
import { env } from "cloudflare:workers";

import { submitContactLead } from "@/server/api";
import { NotificationConfigurationError } from "@/server/notifications";
import type { NotificationError } from "@/server/notifications";
import { ContactRequestSchema } from "@/server/schemas";

import { SENT_CONTACT_ACTION_STATE } from "./contact-action-state";
import type { ContactActionState } from "./contact-action-state";

function readWorkerBindings() {
  return {
    LANDING_SLACK_WEBHOOK_URL:
      typeof env.LANDING_SLACK_WEBHOOK_URL === "string"
        ? env.LANDING_SLACK_WEBHOOK_URL
        : undefined,
  };
}

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
  contact: defineAction({
    accept: "form",
    input: ContactRequestSchema,
    handler: async (input, { request }): Promise<ContactActionState> => {
      const result = await submitContactLead(input, {
        bindings: readWorkerBindings(),
        request,
      });

      if (result.isErr()) {
        throw createActionError(result.error);
      }

      return SENT_CONTACT_ACTION_STATE;
    },
  }),
};
