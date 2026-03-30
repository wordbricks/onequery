import { zValidator } from "@hono/zod-validator";
import {
  and,
  CredentialsSchema,
  eq,
  getDatabaseSchema,
  isGitHubCredentials,
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
import { fetchGitHubApi } from "../../services/github/relay";
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

const githubQuerySchema = createProviderQuerySchema(methodSchema);

const githubFetchOptionsSchema = z
  .object({
    body: z.unknown().optional(),
    bodyBase64: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    method: z
      .enum(["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"])
      .optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
      .optional(),
  })
  .refine(
    (value) => !(value.body !== undefined && value.bodyBase64 !== undefined),
    {
      message: "Provide either body or bodyBase64, not both",
      path: ["bodyBase64"],
    }
  );

const fetchGitHubApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: githubFetchOptionsSchema.optional(),
  repository: z.string().min(1).optional(),
});

export const dataSourcesGitHubQueryRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().post(
  "/github/query",
  zValidator("json", githubQuerySchema, zodProblemHook()),
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

    const githubDataSources = await db.query.dataSources.findMany({
      where: and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, "github"),
        eq(dataSources.status, "active")
      ),
    });
    if (githubDataSources.length === 0) {
      return c.json({ error: "Active GitHub data source not found" }, 404);
    }

    const defaultDataSources = githubDataSources.filter(
      (dataSource: { useAsDataSource: boolean }) => dataSource.useAsDataSource
    );
    if (defaultDataSources.length > 1) {
      return c.json(
        {
          error:
            "Multiple default GitHub data sources found. Keep only one GitHub data source with useAsDataSource=true.",
        },
        409
      );
    }

    const dataSource =
      defaultDataSources[0] ??
      (githubDataSources.length === 1 ? githubDataSources[0] : null);
    if (!dataSource) {
      return c.json(
        {
          error:
            "Multiple active GitHub data sources found. Set exactly one as default (useAsDataSource=true).",
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

    if (!isGitHubCredentials(credentialsOutcome.credentials)) {
      return c.json(createCredentialTypeQueryError("GitHub"), 400);
    }

    if (input.method === "fetch_api") {
      const parsedRequest = parseProviderRequest(
        fetchGitHubApiRequestSchema,
        input.request,
        "Invalid GitHub fetch_api request payload"
      );
      if (!parsedRequest.ok) {
        return c.json({ error: parsedRequest.error }, 400);
      }

      const resultOutcome = await fetchGitHubApi({
        credentials: credentialsOutcome.credentials,
        endpoint: parsedRequest.data.endpoint,
        options: parsedRequest.data.options,
        repository: parsedRequest.data.repository,
      })
        .then((value) => ({ ok: true as const, value }))
        .catch((error: unknown) => ({ error, ok: false as const }));
      if (!resultOutcome.ok) {
        return c.json(
          createPrefixedQueryError(
            "GitHub relay request failed",
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

    return c.json({ error: "Unsupported GitHub relay method" }, 400);
  }
);
