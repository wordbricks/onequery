import { listPublicSourceProviders } from "@onequery/db/server";
import { Hono } from "hono";

import type { BetterAuthSessionVariables } from "../../middleware/better-auth-session";
import type { ServerRuntimeVariables } from "../../runtime-context";

export const dataSourcesProvidersRoute = new Hono<{
  Variables: ServerRuntimeVariables & BetterAuthSessionVariables;
}>().get("/", (c) =>
  c.json({
    providers: listPublicSourceProviders(),
  })
);
