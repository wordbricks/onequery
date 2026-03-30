import type { MiddlewareHandler } from "hono";

import type { ServerEnv } from "../env";
import { verifyOrgAccess } from "../lib/verify-org-access";
import type { SessionVariables } from "./session";

/**
 * Requires:
 * - an authenticated session (sessionMiddleware must have run earlier)
 * - an `organizationId` query param
 * - the user to be a member of that organization
 *
 * This is meant for dashboard-facing endpoints that accept `organizationId` via
 * query string.
 */
export function requireOrgAccess(): MiddlewareHandler<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}> {
  return async (c, next) => {
    const session = c.get("session");
    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const organizationId = c.req.query("organizationId");
    if (!organizationId) {
      return c.json({ error: "organizationId is required" }, 400);
    }

    const db = c.var.storage.db;
    const hasAccess = await verifyOrgAccess(
      db,
      session.user.id,
      organizationId
    );

    if (!hasAccess) {
      return c.json(
        { error: "Forbidden: Not a member of this organization" },
        403
      );
    }

    await next();
  };
}
