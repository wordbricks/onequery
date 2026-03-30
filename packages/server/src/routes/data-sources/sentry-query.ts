import { zValidator } from "@hono/zod-validator";
import {
  and,
  CredentialsSchema,
  eq,
  getDatabaseSchema,
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
import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
import { fetchSentryApi } from "../../services/sentry/relay";
import {
  createCredentialTypeQueryError,
  createPrefixedQueryError,
} from "./query-errors";
import { resolveAccessibleOrganizationId } from "./query-organization";
import {
  createProviderQuerySchema,
  parseProviderRequest,
} from "./query-validation";

const methodSchema = z.enum(["fetch_api"]);

const sentryQuerySchema = createProviderQuerySchema(methodSchema);

const sentryFetchOptionsSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

const sentryFetchApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: sentryFetchOptionsSchema.optional(),
});

function buildConflictMessage(input: {
  providerLabel: string;
  multipleDefaults: boolean;
}): string {
  if (input.multipleDefaults) {
    return `Multiple default ${input.providerLabel} data sources found. Keep only one ${input.providerLabel} data source with useAsDataSource=true.`;
  }
  return `Multiple active ${input.providerLabel} data sources found. Set exactly one as default (useAsDataSource=true).`;
}

export const dataSourcesSentryQueryRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().post(
  "/sentry/query",
  zValidator("json", sentryQuerySchema, zodProblemHook()),
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

    const sentryDataSources = await db.query.dataSources.findMany({
      where: and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, "sentry"),
        eq(dataSources.status, "active")
      ),
    });
    if (sentryDataSources.length === 0) {
      return c.json({ error: "Active Sentry data source not found" }, 404);
    }

    const defaultDataSources = sentryDataSources.filter(
      (dataSource: { useAsDataSource: boolean }) => dataSource.useAsDataSource
    );
    if (defaultDataSources.length > 1) {
      return c.json(
        {
          error: buildConflictMessage({
            multipleDefaults: true,
            providerLabel: "Sentry",
          }),
        },
        409
      );
    }

    const dataSource =
      defaultDataSources[0] ??
      (sentryDataSources.length === 1 ? sentryDataSources[0] : null);
    if (!dataSource) {
      return c.json(
        {
          error: buildConflictMessage({
            multipleDefaults: false,
            providerLabel: "Sentry",
          }),
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

    const decryptedCredentials = credentialsOutcome.credentials;
    if (decryptedCredentials.type !== "sentry") {
      return c.json(createCredentialTypeQueryError("Sentry"), 400);
    }
    const sentryCredentials = decryptedCredentials;

    const request = parseProviderRequest(
      sentryFetchApiRequestSchema,
      input.request,
      "Invalid Sentry fetch_api request payload"
    );
    if (!request.ok) {
      return c.json({ error: request.error }, 400);
    }

    const resultOutcome = await fetchSentryApi({
      credentials: sentryCredentials,
      endpoint: request.data.endpoint,
      options: request.data.options,
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));

    if (!resultOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "Sentry relay request failed",
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
