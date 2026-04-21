import { Hono } from "hono";

import {
  createProductUpdatesNotification,
  deliverLandingNotification,
} from "../../landing/landing-notifications";
import type { LandingAppEnv } from "../../types";
import { ProductUpdatesRequestSchema } from "./schemas";
import {
  landingValidator,
  notificationServiceUnavailableResponse,
  resolveLandingNotificationDeliveryFromContext,
} from "./shared";
import type { LandingProductUpdatesResponse } from "./shared";

export const productUpdatesRoute = new Hono<LandingAppEnv>().post(
  "/product-updates",
  landingValidator("json", ProductUpdatesRequestSchema),
  async (c) => {
    const { email } = c.req.valid("json");
    const normalizedEmail = email.toLowerCase();
    const result = await deliverLandingNotification(
      {
        delivery: resolveLandingNotificationDeliveryFromContext(c),
        notificationType: "product_updates",
        payload: createProductUpdatesNotification(normalizedEmail),
      },
      c.var.logger
    );
    if (result.isErr()) {
      return notificationServiceUnavailableResponse(c, result.error);
    }

    return c.json<LandingProductUpdatesResponse, 200>(
      { email: normalizedEmail },
      200
    );
  }
);
