import { ActionError, defineAction } from "astro:actions";
import { env } from "cloudflare:workers";

import {
  submitContactLead,
  submitProductUpdatesLead,
} from "../server/landing-api";
import {
  ContactRequestSchema,
  ProductUpdatesRequestSchema,
} from "../server/landing-schemas";
import { LandingNotificationConfigurationError } from "../server/landing/landing-notifications";
import type { LandingNotificationError } from "../server/landing/landing-notifications";
import { SENT_CONTACT_ACTION_STATE } from "./contact-action-state";
import type { ContactActionState } from "./contact-action-state";

function readLandingWorkerBindings() {
  return {
    LANDING_SLACK_WEBHOOK_URL:
      typeof env.LANDING_SLACK_WEBHOOK_URL === "string"
        ? env.LANDING_SLACK_WEBHOOK_URL
        : undefined,
  };
}

function createLandingActionError(error: LandingNotificationError) {
  const message = LandingNotificationConfigurationError.is(error)
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
        bindings: readLandingWorkerBindings(),
        request,
      });

      if (result.isErr()) {
        throw createLandingActionError(result.error);
      }

      return SENT_CONTACT_ACTION_STATE;
    },
  }),
  productUpdates: defineAction({
    accept: "form",
    input: ProductUpdatesRequestSchema,
    handler: async (input, { request }) => {
      const result = await submitProductUpdatesLead(input, {
        bindings: readLandingWorkerBindings(),
        request,
      });

      if (result.isErr()) {
        throw createLandingActionError(result.error);
      }

      return result.value;
    },
  }),
};
