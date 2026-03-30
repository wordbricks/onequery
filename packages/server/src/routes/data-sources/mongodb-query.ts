import { zValidator } from "@hono/zod-validator";
import {
  and,
  CredentialsSchema,
  eq,
  getDatabaseSchema,
  isMongoCredentials,
} from "@onequery/db/server";
import { Hono } from "hono";
import { z } from "zod";

import type { ServerEnv } from "../../env";
import type { SessionVariables } from "../../middleware/session";
import { zodProblemHook } from "../../problem-details/zod-problem-hook";
import {
  decryptCredentialsObject,
  deriveKeyFromBase64,
} from "../../services/crypto/credential-encryption";
import {
  findMongoDocuments,
  listMongoCollections,
  listMongoDatabases,
} from "../../services/mongodb/relay";
import {
  createCredentialTypeQueryError,
  createPrefixedQueryError,
} from "./query-errors";
import { resolveAccessibleOrganizationId } from "./query-organization";
import {
  createProviderQuerySchema,
  parseProviderRequest,
} from "./query-validation";

const methodSchema = z.enum([
  "list_databases",
  "list_collections",
  "find_documents",
]);

const mongodbQuerySchema = createProviderQuerySchema(methodSchema);

const listCollectionsRequestSchema = z.object({
  database: z.string().min(1).optional(),
});

const findDocumentsRequestSchema = z.object({
  collection: z.string().min(1),
  database: z.string().min(1).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().optional(),
  maxTimeMs: z.number().int().optional(),
  projection: z.record(z.string(), z.unknown()).optional(),
  skip: z.number().int().optional(),
  sort: z.record(z.string(), z.unknown()).optional(),
});

export const dataSourcesMongoDbQueryRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().post(
  "/mongodb/query",
  zValidator("json", mongodbQuerySchema, zodProblemHook()),
  async (c) => {
    const input = c.req.valid("json");
    const db = c.var.storage.db;
    const { dataSources } = getDatabaseSchema(db);
    const organizationAccess = await resolveAccessibleOrganizationId(
      c,
      db,
      input
    );
    if (!organizationAccess.ok) {
      return organizationAccess.response;
    }
    const { organizationId } = organizationAccess;

    const mongodbDataSources = await db.query.dataSources.findMany({
      where: and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, "mongodb"),
        eq(dataSources.status, "active")
      ),
    });
    if (mongodbDataSources.length === 0) {
      return c.json({ error: "Active MongoDB data source not found" }, 404);
    }

    const defaultDataSources = mongodbDataSources.filter(
      (dataSource: { useAsDataSource: boolean }) => dataSource.useAsDataSource
    );
    if (defaultDataSources.length > 1) {
      return c.json(
        {
          error:
            "Multiple default MongoDB data sources found. Keep only one MongoDB data source with useAsDataSource=true.",
        },
        409
      );
    }

    const dataSource =
      defaultDataSources[0] ??
      (mongodbDataSources.length === 1 ? mongodbDataSources[0] : null);
    if (!dataSource) {
      return c.json(
        {
          error:
            "Multiple active MongoDB data sources found. Set exactly one as default (useAsDataSource=true).",
        },
        409
      );
    }

    const masterKey = deriveKeyFromBase64(c.env.MASTER_ENCRYPTION_KEY);
    const credentialsOutcome = await Promise.resolve()
      .then(() =>
        decryptCredentialsObject(
          dataSource.credentialsEncrypted,
          dataSource.credentialsIv,
          masterKey,
          CredentialsSchema
        )
      )
      .then((credentials) => ({ credentials, ok: true as const }))
      .catch((error: unknown) => ({ error, ok: false as const }));
    if (!credentialsOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "Failed to decrypt credentials",
          credentialsOutcome.error
        ),
        500
      );
    }
    if (!isMongoCredentials(credentialsOutcome.credentials)) {
      return c.json(createCredentialTypeQueryError("MongoDB"), 400);
    }
    const mongoCredentials = credentialsOutcome.credentials;

    let relayPromise: Promise<unknown>;

    if (input.method === "list_databases") {
      relayPromise = listMongoDatabases({
        credentials: mongoCredentials,
      });
    } else if (input.method === "list_collections") {
      const requestResult = parseProviderRequest(
        listCollectionsRequestSchema,
        input.request,
        "Invalid MongoDB list_collections request payload"
      );
      if (!requestResult.ok) {
        return c.json({ error: requestResult.error }, 400);
      }
      relayPromise = listMongoCollections({
        credentials: mongoCredentials,
        request: requestResult.data,
      });
    } else {
      const requestResult = parseProviderRequest(
        findDocumentsRequestSchema,
        input.request,
        "Invalid MongoDB find_documents request payload"
      );
      if (!requestResult.ok) {
        return c.json({ error: requestResult.error }, 400);
      }
      relayPromise = findMongoDocuments({
        credentials: mongoCredentials,
        request: requestResult.data,
      });
    }

    const resultOutcome = await relayPromise
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));

    if (!resultOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "MongoDB relay request failed",
          resultOutcome.error
        ),
        502
      );
    }

    await db
      .update(dataSources)
      .set({ lastUsedAt: new Date() })
      .where(eq(dataSources.id, dataSource.id));

    return c.json(resultOutcome.value);
  }
);
