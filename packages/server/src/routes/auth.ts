import { Hono } from "hono";

import { readAuthBootstrapState } from "../auth/self-host";
import type { ServerRuntimeVariables } from "../runtime-context";
import type { StorageVariables } from "../storage";

export const authRoute = new Hono<{
  Variables: ServerRuntimeVariables & StorageVariables;
}>()
  .get("/bootstrap-state", async (c) => {
    const state = await readAuthBootstrapState({
      db: c.var.storage.db,
    });

    return c.json({
      ...state,
      emailDeliveryMode: c.var.storage.emailDeliveryMode,
      publicSignupAllowed: state.signupMode === "first-user",
    });
  })
  .on(["POST", "GET"], "/*", async (c) =>
    c.var.storage.auth.handler(c.req.raw)
  );
