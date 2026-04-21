import { Hono } from "hono";

import type { LandingAppEnv } from "../../types";
import { contactRoute } from "./contact";
import { productUpdatesRoute } from "./product-updates";

export const landingRoute = new Hono<LandingAppEnv>()
  .route("/", productUpdatesRoute)
  .route("/", contactRoute);
