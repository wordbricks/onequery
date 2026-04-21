import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import {
  createContactNotification,
  deliverLandingNotification,
} from "../../landing/landing-notifications";
import type { LandingAppEnv } from "../../types";
import { ContactRequestSchema } from "./schemas";
import {
  notificationProblem,
  resolveLandingNotificationDeliveryFromContext,
} from "./shared";

export const contactRoute = new Hono<LandingAppEnv>().post(
  "/contact",
  zValidator("json", ContactRequestSchema),
  async (c) => {
    const { email, message, name } = c.req.valid("json");
    const normalizedEmail = email.toLowerCase();
    const result = await deliverLandingNotification(
      {
        delivery: resolveLandingNotificationDeliveryFromContext(c),
        payload: createContactNotification({
          email: normalizedEmail,
          message,
          name,
        }),
      },
      c.var.logger
    );
    if (result.isErr()) {
      return notificationProblem(c, result.error);
    }

    return c.json<Record<never, never>, 200>({}, 200);
  }
);
