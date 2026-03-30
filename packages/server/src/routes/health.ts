import { Hono } from "hono";

import type { ServerEnv } from "../env";

export const healthRoute = new Hono<{ Bindings: ServerEnv }>().get(
  "/health",
  (c) =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    })
);
