import { zValidator } from "@hono/zod-validator";
import { count, dataSources, eq } from "@onequery/db/server";
import { Hono } from "hono";
import { z } from "zod";

import { requireOrgAccess } from "../middleware/require-org-access";
import type { SessionVariables } from "../middleware/session";
import { zodProblemHook } from "../problem-details/zod-problem-hook";

const QuerySchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
});

export const statsRoute = new Hono<{
  Variables: SessionVariables;
}>()
  .use("*", requireOrgAccess())
  .get("/", zValidator("query", QuerySchema, zodProblemHook()), async (c) => {
    const { organizationId } = c.req.valid("query");
    const db = c.var.storage.db;

    const [dataSourcesResult] = await Promise.all([
      db
        .select({ count: count() })
        .from(dataSources)
        .where(eq(dataSources.organizationId, organizationId)),
    ]);

    return c.json({
      dataSourcesCount: dataSourcesResult[0]?.count ?? 0,
    });
  });
