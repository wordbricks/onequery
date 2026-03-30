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
import {
  exportMixpanelEvents,
  fetchMixpanelQueryApi,
  MAX_MIXPANEL_ENGAGE_PAGE_SIZE,
  queryMixpanelEngage,
  queryMixpanelSegmentation,
} from "../../services/mixpanel/relay";
import type { MixpanelFetchOptions } from "../../services/mixpanel/relay";
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

const methodSchema = z.enum([
  "query_engage",
  "query_segmentation",
  "fetch_query_api",
  "export_events",
]);

const mixpanelQuerySchema = createProviderQuerySchema(methodSchema);

const mixpanelEngageRequestSchema = z.object({
  outputProperties: z.array(z.string().min(1)).optional(),
  page: z.number().int().min(0).optional(),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_MIXPANEL_ENGAGE_PAGE_SIZE)
    .optional(),
  where: z.string().min(1).optional(),
});

const mixpanelSegmentationRequestSchema = z.object({
  event: z.string().min(1),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  type: z.enum(["general", "unique", "average"]).optional(),
  unit: z.enum(["hour", "day", "week", "month"]).optional(),
  where: z.string().min(1).optional(),
});

const mixpanelFetchOptionsSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  bodyFormat: z.enum(["form", "json"]).optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

const mixpanelFetchQueryApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: mixpanelFetchOptionsSchema.optional(),
});

const mixpanelExportEventsRequestSchema = z.object({
  options: mixpanelFetchOptionsSchema.optional(),
});

function toMixpanelFetchOptions(
  value: unknown
): MixpanelFetchOptions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as MixpanelFetchOptions;
}

export const dataSourcesMixpanelQueryRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>().post(
  "/mixpanel/query",
  zValidator("json", mixpanelQuerySchema, zodProblemHook()),
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

    const mixpanelDataSources = await db.query.dataSources.findMany({
      where: and(
        eq(dataSources.organizationId, organizationId),
        eq(dataSources.provider, "mixpanel"),
        eq(dataSources.status, "active")
      ),
    });
    if (mixpanelDataSources.length === 0) {
      return c.json({ error: "Active Mixpanel data source not found" }, 404);
    }

    const defaultDataSources = mixpanelDataSources.filter(
      (dataSource: { useAsDataSource: boolean }) => dataSource.useAsDataSource
    );
    if (defaultDataSources.length > 1) {
      return c.json(
        {
          error:
            "Multiple default Mixpanel data sources found. Keep only one Mixpanel data source with useAsDataSource=true.",
        },
        409
      );
    }

    const dataSource =
      defaultDataSources[0] ??
      (mixpanelDataSources.length === 1 ? mixpanelDataSources[0] : null);
    if (!dataSource) {
      return c.json(
        {
          error:
            "Multiple active Mixpanel data sources found. Set exactly one as default (useAsDataSource=true).",
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

    if (credentialsOutcome.credentials.type !== "mixpanel") {
      return c.json(createCredentialTypeQueryError("Mixpanel"), 400);
    }
    const mixpanelCredentials = credentialsOutcome.credentials;

    let relayPromise: Promise<unknown>;

    if (input.method === "query_engage") {
      const request = parseProviderRequest(
        mixpanelEngageRequestSchema,
        input.request,
        "Invalid Mixpanel engage request payload"
      );
      if (!request.ok) {
        return c.json({ error: request.error }, 400);
      }
      relayPromise = queryMixpanelEngage({
        credentials: mixpanelCredentials,
        request: request.data,
      });
    } else if (input.method === "query_segmentation") {
      const request = parseProviderRequest(
        mixpanelSegmentationRequestSchema,
        input.request,
        "Invalid Mixpanel segmentation request payload"
      );
      if (!request.ok) {
        return c.json({ error: request.error }, 400);
      }
      relayPromise = queryMixpanelSegmentation({
        credentials: mixpanelCredentials,
        request: request.data,
      });
    } else if (input.method === "fetch_query_api") {
      const request = parseProviderRequest(
        mixpanelFetchQueryApiRequestSchema,
        input.request,
        "Invalid Mixpanel query API request payload"
      );
      if (!request.ok) {
        return c.json({ error: request.error }, 400);
      }
      relayPromise = fetchMixpanelQueryApi({
        credentials: mixpanelCredentials,
        endpoint: request.data.endpoint,
        options: toMixpanelFetchOptions(request.data.options),
      });
    } else {
      const request = parseProviderRequest(
        mixpanelExportEventsRequestSchema,
        input.request,
        "Invalid Mixpanel export events request payload"
      );
      if (!request.ok) {
        return c.json({ error: request.error }, 400);
      }
      relayPromise = exportMixpanelEvents({
        credentials: mixpanelCredentials,
        options: toMixpanelFetchOptions(request.data.options),
      });
    }

    const resultOutcome = await relayPromise
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));

    if (!resultOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "Mixpanel relay request failed",
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
