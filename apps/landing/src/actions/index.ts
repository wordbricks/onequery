import { ActionError, defineAction } from "astro:actions";

import { submitContactLead } from "@/server/api";
import { readWorkerBindings } from "@/server/bindings";
import { NotificationConfigurationError } from "@/server/notifications";
import type { NotificationError } from "@/server/notifications";
import { ContactRequestSchema } from "@/server/schemas";

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
