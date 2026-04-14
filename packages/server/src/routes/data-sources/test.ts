import { zValidator } from "@hono/zod-validator";
import { and, eq, getDatabaseSchema } from "@onequery/db/server";
import { Hono } from "hono";

import { requireOrgAccess } from "../../middleware/require-org-access";
import type { SessionVariables } from "../../middleware/session";
import { zodProblemHook } from "../../problem-details/zod-problem-hook";
import type { ServerRuntimeVariables } from "../../runtime-context";
import { prepareDataSourceCredentials } from "../../services/data-source-credentials/prepare-data-source-credentials";
import { testDataSource } from "../../services/data-source-tester";
import { OrgQuerySchema } from "./schemas";

export const dataSourcesTestRoute = new Hono<{
  Variables: ServerRuntimeVariables & SessionVariables;
}>()
  .use("*", requireOrgAccess())
  .post(
    "/:id/test",
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const id = c.req.param("id");
      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);

      const dataSource = await db.query.dataSources.findFirst({
        where: and(
          eq(dataSources.id, id),
          eq(dataSources.organizationId, organizationId)
        ),
      });

      if (!dataSource) {
        return c.json({ error: "Data source not found" }, 404);
      }

      const preparedCredentials = await prepareDataSourceCredentials({
        dataSource,
        masterEncryptionKey: c.var.runtime.crypto.masterEncryptionKey,
      });
      if (preparedCredentials.isErr()) {
        return c.json({ error: preparedCredentials.error.message }, 500);
      }

      const result = await testDataSource(
        preparedCredentials.value.credentials,
        {
          db,
          organizationId,
        }
      );
      const now = new Date();

      if (result.kind === "supported") {
        await db
          .update(dataSources)
          .set({
            errorMessage: result.result.error ?? null,
            lastUsedAt: now,
            status: result.result.success ? "active" : "error",
            updatedAt: now,
          })
          .where(eq(dataSources.id, id));

        return c.json({ result });
      }

      return c.json({ result });
    }
  );
