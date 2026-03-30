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
import { fetchAmplitudeApi } from "../../services/amplitude/relay";
import type { AmplitudeFetchOptions } from "../../services/amplitude/relay";
import {
  decryptCredentialsObject,
  deriveKeyFromBase64,
} from "../../services/crypto/credential-encryption";
import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
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

const amplitudeQuerySchema = createProviderQuerySchema(methodSchema);

const amplitudeFetchOptionsSchema = z.object({
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

const amplitudeFetchApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: amplitudeFetchOptionsSchema.optional(),
});

function toAmplitudeFetchOptions(
  value: unknown
): AmplitudeFetchOptions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as AmplitudeFetchOptions;
}

export const dataSourcesAmplitudeQueryRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().post(
  "/amplitude/query",
  zValidator("json", amplitudeQuerySchema, zodProblemHook()),
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

    const amplitudeDataSources = await db.query.dataSources.findMany({
      where: and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, "amplitude"),
        eq(dataSources.status, "active")
      ),
    });
    if (amplitudeDataSources.length === 0) {
      return c.json({ error: "Active Amplitude data source not found" }, 404);
    }

    const defaultDataSources = amplitudeDataSources.filter(
      (dataSource: { useAsDataSource: boolean }) => dataSource.useAsDataSource
    );
    if (defaultDataSources.length > 1) {
      return c.json(
        {
          error:
            "Multiple default Amplitude data sources found. Keep only one Amplitude data source with useAsDataSource=true.",
        },
        409
      );
    }

    const dataSource =
      defaultDataSources[0] ??
      (amplitudeDataSources.length === 1 ? amplitudeDataSources[0] : null);
    if (!dataSource) {
      return c.json(
        {
          error:
            "Multiple active Amplitude data sources found. Set exactly one as default (useAsDataSource=true).",
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

    if (credentialsOutcome.credentials.type !== "amplitude") {
      return c.json(createCredentialTypeQueryError("Amplitude"), 400);
    }
    const amplitudeCredentials = credentialsOutcome.credentials;

    const request = parseProviderRequest(
      amplitudeFetchApiRequestSchema,
      input.request,
      "Invalid Amplitude fetch_api request payload"
    );
    if (!request.ok) {
      return c.json({ error: request.error }, 400);
    }

    const resultOutcome = await fetchAmplitudeApi({
      credentials: amplitudeCredentials,
      endpoint: request.data.endpoint,
      options: toAmplitudeFetchOptions(request.data.options),
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));

    if (!resultOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "Amplitude relay request failed",
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
