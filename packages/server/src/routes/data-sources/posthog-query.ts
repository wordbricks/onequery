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
import { runPostHogQuery } from "../../services/posthog/relay";
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

const postHogQuerySchema = createProviderQuerySchema(z.enum(["run_query"]));

const postHogRunQueryRequestSchema = z.object({
  query: z.record(z.string(), z.unknown()),
  refresh: z.string().min(1).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

export const dataSourcesPostHogQueryRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().post(
  "/posthog/query",
  zValidator("json", postHogQuerySchema, zodProblemHook()),
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

    const postHogDataSources = await db.query.dataSources.findMany({
      where: and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, "posthog"),
        eq(dataSources.status, "active")
      ),
    });
    if (postHogDataSources.length === 0) {
      return c.json({ error: "Active PostHog data source not found" }, 404);
    }

    const defaultDataSources = postHogDataSources.filter(
      (dataSource: { useAsDataSource: boolean }) => dataSource.useAsDataSource
    );
    if (defaultDataSources.length > 1) {
      return c.json(
        {
          error:
            "Multiple default PostHog data sources found. Keep only one PostHog data source with useAsDataSource=true.",
        },
        409
      );
    }

    const dataSource =
      defaultDataSources[0] ??
      (postHogDataSources.length === 1 ? postHogDataSources[0] : null);
    if (!dataSource) {
      return c.json(
        {
          error:
            "Multiple active PostHog data sources found. Set exactly one as default (useAsDataSource=true).",
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

    if (credentialsOutcome.credentials.type !== "posthog") {
      return c.json(createCredentialTypeQueryError("PostHog"), 400);
    }
    const postHogCredentials = credentialsOutcome.credentials;

    const request = parseProviderRequest(
      postHogRunQueryRequestSchema,
      input.request,
      "Invalid PostHog run_query request payload"
    );
    if (!request.ok) {
      return c.json({ error: request.error }, 400);
    }

    const resultOutcome = await runPostHogQuery({
      credentials: postHogCredentials,
      query: request.data.query,
      refresh: request.data.refresh,
      timeoutMs: request.data.timeoutMs,
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));

    if (!resultOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "PostHog relay request failed",
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
