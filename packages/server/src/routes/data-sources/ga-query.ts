import { zValidator } from "@hono/zod-validator";
import { isRecord } from "@onequery/base";
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
import {
  resolveGoogleAnalyticsAccessToken,
  resolveGoogleAnalyticsPropertyPath,
  runGoogleAnalyticsDataRequest,
} from "../../services/google-analytics/relay";
import {
  createCredentialTypeQueryError,
  createPrefixedQueryError,
  createQueryError,
} from "./query-errors";
import { resolveAccessibleOrganizationId } from "./query-organization";
import { createProviderQuerySchema } from "./query-validation";

const methodSchema = z.enum(["run_report", "run_realtime_report"]);

const gaQuerySchema = createProviderQuerySchema(methodSchema);

export const dataSourcesGaQueryRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().post(
  "/ga/query",
  zValidator("json", gaQuerySchema, zodProblemHook()),
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

    const gaDataSources = await db.query.dataSources.findMany({
      where: and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, "ga"),
        eq(dataSources.status, "active")
      ),
    });
    if (gaDataSources.length === 0) {
      return c.json(
        { error: "Active Google Analytics data source not found" },
        404
      );
    }
    const defaultDataSources = gaDataSources.filter(
      (dataSource: { useAsDataSource: boolean }) => dataSource.useAsDataSource
    );
    if (defaultDataSources.length > 1) {
      return c.json(
        {
          error:
            "Multiple default Google Analytics data sources found. Keep only one GA data source with useAsDataSource=true.",
        },
        409
      );
    }

    const dataSource =
      defaultDataSources[0] ??
      (gaDataSources.length === 1 ? gaDataSources[0] : null);
    if (!dataSource) {
      return c.json(
        {
          error:
            "Multiple active Google Analytics data sources found. Set exactly one as default (useAsDataSource=true).",
        },
        409
      );
    }

    const masterKey = deriveKeyFromBase64(c.env.MASTER_ENCRYPTION_KEY);
    const decryptOutcome = await Promise.resolve()
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
    if (!decryptOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "Failed to decrypt credentials",
          decryptOutcome.error
        ),
        500
      );
    }

    if (decryptOutcome.credentials.type !== "ga") {
      return c.json(createCredentialTypeQueryError("Google Analytics"), 400);
    }

    const propertyPath = resolveGoogleAnalyticsPropertyPath({
      credentials: decryptOutcome.credentials,
      request: input.request,
    });
    if (!propertyPath) {
      return c.json(
        {
          error:
            "Property ID is required in request or saved data source credentials",
        },
        400
      );
    }

    const tokenOutcome = await resolveGoogleAnalyticsAccessToken({
      credentials: decryptOutcome.credentials,
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));
    if (!tokenOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "Failed to get Google access token",
          tokenOutcome.error
        ),
        500
      );
    }

    await db
      .update(dataSources)
      .set({ lastUsedAt: new Date() })
      .where(eq(dataSources.id, dataSource.id));

    const requestBody = { ...input.request };
    delete requestBody.property;
    const gaResponse = await runGoogleAnalyticsDataRequest({
      accessToken: tokenOutcome.value.accessToken,
      method: input.method,
      propertyPath,
      requestBody,
    });
    if (!gaResponse.ok) {
      const errorText = await gaResponse.text().catch(() => "Unknown error");
      return Response.json(
        createQueryError(
          `Google Analytics Data API error: ${gaResponse.status} ${errorText}`
        ),
        {
          headers: { "Content-Type": "application/json" },
          status: gaResponse.status,
        }
      );
    }

    const gaResult = await gaResponse
      .json()
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));
    if (!gaResult.ok) {
      return c.json(
        createPrefixedQueryError("Failed to parse GA response", gaResult.error),
        500
      );
    }

    if (!isRecord(gaResult.value)) {
      return c.json(
        {
          error: "Unexpected Google Analytics response format",
        },
        500
      );
    }

    return c.json({
      ...gaResult.value,
      _onequery: {
        resolvedPropertyPath: propertyPath,
      },
    });
  }
);
