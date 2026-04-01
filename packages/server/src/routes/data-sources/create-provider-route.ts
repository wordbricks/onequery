import { zValidator } from "@hono/zod-validator";
import {
  and,
  CredentialsSchema,
  eq,
  getDatabaseSchema,
} from "@onequery/db/server";
import type { ProviderType } from "@onequery/db/server";
import type { Context } from "hono";
import { Hono } from "hono";
import type { z } from "zod";

import type { SessionVariables } from "../../middleware/session";
import { zodProblemHook } from "../../problem-details/zod-problem-hook";
import type { ServerRuntimeVariables } from "../../runtime-context";
import {
  decryptCredentialsObject,
  deriveKeyFromBase64,
} from "../../services/crypto/credential-encryption";
import {
  createCredentialTypeQueryError,
  createPrefixedQueryError,
} from "./query-errors";
import { resolveAccessibleOrganizationId } from "./query-organization";
import { createProviderQuerySchema } from "./query-validation";

type ProviderQueryInput<TMethodSchema extends z.ZodTypeAny> = z.output<
  ReturnType<typeof createProviderQuerySchema<TMethodSchema>>
>;

type ParseRequestResult<TRequest> =
  | { ok: true; data: TRequest }
  | { ok: false; error: string };

interface ProviderRouteOptions<
  TCredentials,
  TMethodSchema extends z.ZodTypeAny,
  TRequest,
> {
  credentialsGuard: (creds: unknown) => creds is TCredentials;
  execute: (input: {
    c: Context<RouteContext>;
    credentials: TCredentials;
    dataSource: {
      id: string;
      credentialsEncrypted: string;
      credentialsIv: string;
      useAsDataSource: boolean;
    };
    method: z.output<TMethodSchema>;
    organizationId: string;
    request: TRequest;
  }) => Promise<Response | unknown>;
  methodSchema: TMethodSchema;
  parseRequest: (
    input: ProviderQueryInput<TMethodSchema>
  ) => ParseRequestResult<TRequest>;
  provider: ProviderType;
  providerLabel: string;
  relayErrorPrefix?: string;
  routePath: string;
  buildConflictMessage?: (input: { multipleDefaults: boolean }) => string;
  missingDataSourceMessage?: string;
}

type RouteContext = {
  Variables: ServerRuntimeVariables & SessionVariables;
};

function buildConflictMessage(input: {
  multipleDefaults: boolean;
  providerLabel: string;
}): string {
  if (input.multipleDefaults) {
    return `Multiple default ${input.providerLabel} data sources found. Keep only one ${input.providerLabel} data source with useAsDataSource=true.`;
  }

  return `Multiple active ${input.providerLabel} data sources found. Set exactly one as default (useAsDataSource=true).`;
}

function selectDataSource<TDataSource extends { useAsDataSource: boolean }>(
  dataSources: readonly TDataSource[]
): { dataSource: TDataSource | null; multipleDefaults: boolean } {
  const defaultDataSources = dataSources.filter(
    (dataSource) => dataSource.useAsDataSource
  );
  if (defaultDataSources.length > 1) {
    return { dataSource: null, multipleDefaults: true };
  }

  return {
    dataSource:
      defaultDataSources[0] ??
      (dataSources.length === 1 ? (dataSources[0] ?? null) : null),
    multipleDefaults: false,
  };
}

export function createProviderRoute<
  TCredentials,
  TMethodSchema extends z.ZodTypeAny,
  TRequest,
>(options: ProviderRouteOptions<TCredentials, TMethodSchema, TRequest>) {
  const querySchema = createProviderQuerySchema(options.methodSchema);

  return new Hono<RouteContext>().post(
    options.routePath,
    zValidator("json", querySchema, zodProblemHook()),
    async (c) => {
      const input = c.req.valid("json") as ProviderQueryInput<TMethodSchema> & {
        method: z.output<TMethodSchema>;
        organizationId?: string;
        organizationSlug?: string;
        request: unknown;
      };
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

      const providerDataSources = await db.query.dataSources.findMany({
        columns: {
          id: true,
          credentialsEncrypted: true,
          credentialsIv: true,
          useAsDataSource: true,
        },
        where: and(
          eq(dataSources.organizationId, organizationAccess.organizationId),
          eq(dataSources.provider, options.provider),
          eq(dataSources.status, "active")
        ),
      });

      if (providerDataSources.length === 0) {
        return c.json(
          {
            error:
              options.missingDataSourceMessage ??
              `Active ${options.providerLabel} data source not found`,
          },
          404
        );
      }

      const selected = selectDataSource(providerDataSources);
      const dataSource = selected.dataSource;
      if (!dataSource) {
        return c.json(
          {
            error:
              options.buildConflictMessage?.({
                multipleDefaults: selected.multipleDefaults,
              }) ??
              buildConflictMessage({
                multipleDefaults: selected.multipleDefaults,
                providerLabel: options.providerLabel,
              }),
          },
          409
        );
      }

      const masterKey = deriveKeyFromBase64(
        c.var.runtime.crypto.masterEncryptionKey
      );
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

      if (!options.credentialsGuard(credentialsOutcome.credentials)) {
        return c.json(
          createCredentialTypeQueryError(options.providerLabel),
          400
        );
      }

      const request = options.parseRequest(input);
      if (!request.ok) {
        return c.json({ error: request.error }, 400);
      }

      const result = await Promise.resolve()
        .then(() =>
          options.execute({
            c,
            credentials: credentialsOutcome.credentials as TCredentials,
            dataSource,
            method: input.method,
            organizationId: organizationAccess.organizationId,
            request: request.data,
          })
        )
        .then((value) => ({ ok: true as const, value }))
        .catch((error: unknown) => ({ error, ok: false as const }));

      if (!result.ok) {
        return c.json(
          createPrefixedQueryError(
            options.relayErrorPrefix ??
              `${options.providerLabel} relay request failed`,
            result.error
          ),
          502
        );
      }

      if (result.value instanceof Response && !result.value.ok) {
        return result.value;
      }

      await db
        .update(dataSources)
        .set({ lastUsedAt: new Date() })
        .where(eq(dataSources.id, dataSource.id));

      if (result.value instanceof Response) {
        return result.value;
      }

      return c.json(result.value);
    }
  );
}
