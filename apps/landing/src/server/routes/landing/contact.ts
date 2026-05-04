import { Hono } from "hono";

import {
  createContactNotification,
  deliverLandingNotification,
} from "../../landing/landing-notifications";
import type { LandingAppEnv } from "../../types";
import { ContactRequestSchema } from "./schemas";
import {
  landingValidator,
  notificationServiceUnavailableResponse,
  resolveLandingNotificationDeliveryFromContext,
} from "./shared";

export const contactRoute = new Hono<LandingAppEnv>().post(
  "/contact",
  landingValidator("json", ContactRequestSchema),
  async (c) => {
    const { email, message, name } = c.req.valid("json");
    const normalizedEmail = email.toLowerCase();
    const result = await deliverLandingNotification({
      delivery: resolveLandingNotificationDeliveryFromContext(c),
      notificationType: "contact",
      payload: createContactNotification({
        email: normalizedEmail,
        message,
        name,
      }),
    });
    if (result.isErr()) {
      return notificationServiceUnavailableResponse(c, result.error);
    }

    return c.json<Record<never, never>, 200>({}, 200);
  }
);
