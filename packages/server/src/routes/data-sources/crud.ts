import { zValidator } from "@hono/zod-validator";
import { DATA_SOURCE_NAME_DUPLICATE_CODE } from "@onequery/db/constants";
import {
  and,
  credentialSchemaMap,
  eq,
  getDatabaseSchema,
  ne,
} from "@onequery/db/server";
import type { ProviderType } from "@onequery/db/server";
import { Hono } from "hono";

import {
  DATA_SOURCE_NAME_CONFLICT_MESSAGE,
  isDataSourceNameConflict,
} from "../../lib/db-errors";
import { verifyOrgAccess } from "../../lib/verify-org-access";
import { requireOrgAccess } from "../../middleware/require-org-access";
import type { SessionVariables } from "../../middleware/session";
import { zodProblemHook } from "../../problem-details/zod-problem-hook";
import type { ServerRuntimeVariables } from "../../runtime-context";
import { ensureConnectorOrganization } from "../../services/connectors/broker";
import {
  decryptCredentialsObject,
  encryptCredentialsObject,
} from "../../services/crypto/credential-encryption";
import { LEGACY_UNSUPPORTED_TEST_PREFIX } from "../../services/data-source-tester";
import {
  CreateDataSourceSchema,
  OrgQuerySchema,
  UpdateDataSourceSchema,
} from "./schemas";

const GOOGLE_OAUTH_DATA_SOURCE_ERROR =
  "Google Analytics and BigQuery data sources must use service account credentials.";

function doesProviderMatchCredentials(input: {
  provider: ProviderType;
  credentialsType: string;
}): boolean {
  if (input.provider === input.credentialsType) {
    return true;
  }

  // Comment: Supabase is a product-facing alias that reuses the Postgres
  // runtime and credential shape internally.
  return input.provider === "supabase" && input.credentialsType === "postgres";
}

function isUnsupportedGoogleOAuthCredentials(input: {
  provider: ProviderType;
  credentials: { authType?: string; type: string };
}): boolean {
  if (input.provider !== "ga" && input.provider !== "bigquery") {
    return false;
  }

  return input.credentials.authType === "oauth";
}

function getLinearRevocationToken(
  credentials: (typeof credentialSchemaMap)["linear"]["_output"]
): string {
  if ("accessToken" in credentials) {
    return credentials.accessToken;
  }
  return credentials.apiKey;
}

async function revokeLinearToken(input: {
  token: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = new URLSearchParams({
    token: input.token,
    token_type_hint: "access_token",
  });

  const response = await fetch("https://api.linear.app/oauth/revoke", {
    body: body.toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  })
    .then((result) => ({ ok: true as const, result }))
    .catch((error: unknown) => ({ error, ok: false as const }));

  if (!response.ok) {
    return {
      error:
        response.error instanceof Error
          ? response.error.message
          : "Failed to reach Linear revoke endpoint",
      ok: false,
    };
  }

  if (response.result.ok) {
    return { ok: true };
  }

  return {
    error: `Linear revoke failed with status ${response.result.status}`,
    ok: false,
  };
}

export const dataSourcesCrudRoute = new Hono<{
  Variables: ServerRuntimeVariables & SessionVariables;
}>()
  .get(
    "/",
    requireOrgAccess(),
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);

      const result = await db.query.dataSources.findMany({
        columns: {
          id: true,
          provider: true,
          name: true,
          status: true,
          useAsDataSource: true,
          errorMessage: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        where: eq(dataSources.organizationId, organizationId),
      });

      // TODO(legacy-cleanup): Remove this migration shim after all environments
      // have been migrated away from the old unsupported-test error format
      // ("Testing is not supported for provider: ...").
      const legacyUnsupportedIds = result
        .filter((item) => {
          if (item.status !== "error") {
            return false;
          }
          return (
            item.errorMessage?.startsWith(LEGACY_UNSUPPORTED_TEST_PREFIX) ??
            false
          );
        })
        .map((item) => item.id);

      if (legacyUnsupportedIds.length > 0) {
        const now = new Date();
        await Promise.all(
          legacyUnsupportedIds.map((id) =>
            db
              .update(dataSources)
              .set({
                errorMessage: null,
                status: "active",
                updatedAt: now,
              })
              .where(eq(dataSources.id, id))
          )
        );
      }

      const cleanedDataSources = result.map((item) => {
        if (!legacyUnsupportedIds.includes(item.id)) {
          return item;
        }
        return {
          ...item,
          errorMessage: null,
          status: "active" as const,
        };
      });

      return c.json({ dataSources: cleanedDataSources });
    }
  )

  .get(
    "/:id",
    requireOrgAccess(),
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const id = c.req.param("id");
      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);

      const dataSource = await db.query.dataSources.findFirst({
        columns: {
          id: true,
          provider: true,
          name: true,
          status: true,
          useAsDataSource: true,
          errorMessage: true,
          scope: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        where: and(
          eq(dataSources.id, id),
          eq(dataSources.organizationId, organizationId)
        ),
      });

      if (!dataSource) {
        return c.json({ error: "Data source not found" }, 404);
      }

      return c.json({ dataSource });
    }
  )

  .post(
    "/",
    zValidator("json", CreateDataSourceSchema, zodProblemHook()),
    async (c) => {
      const body = c.req.valid("json");
      const session = c.get("session");
      if (!session?.user) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);
      const hasAccess = await verifyOrgAccess(
        db,
        session.user.id,
        body.organizationId
      );
      if (!hasAccess) {
        return c.json(
          { error: "Forbidden: Not a member of this organization" },
          403
        );
      }

      if (
        !doesProviderMatchCredentials({
          credentialsType: body.credentials.type,
          provider: body.provider,
        })
      ) {
        return c.json(
          {
            details: `Provider is '${body.provider}' but credentials type is '${body.credentials.type}'`,
            error: "Provider does not match credentials type",
          },
          400
        );
      }

      if (isUnsupportedGoogleOAuthCredentials(body)) {
        return c.json({ error: GOOGLE_OAUTH_DATA_SOURCE_ERROR }, 400);
      }

      if (
        body.provider === "aws_athena_connector" &&
        body.credentials.type === "aws_athena_connector"
      ) {
        const organizationCheck = await ensureConnectorOrganization({
          connectorId: body.credentials.connectorId,
          db,
          organizationId: body.organizationId,
        });
        if (!organizationCheck.ok) {
          return c.json(
            { error: organizationCheck.error },
            organizationCheck.status
          );
        }
      }

      const name = body.name;
      if (!name) {
        return c.json({ error: "Name is required" }, 400);
      }

      const encrypted = encryptCredentialsObject(
        body.credentials,
        c.var.runtime.crypto.masterEncryptionKey
      );
      const providerType: ProviderType = body.provider;

      const [inserted] = await db
        .insert(dataSources)
        .values({
          credentialsEncrypted: encrypted.ciphertext,
          credentialsIv: encrypted.iv,
          name,
          organizationId: body.organizationId,
          provider: providerType,
          status: "active",
        })
        .onConflictDoNothing({
          target: [dataSources.organizationId, dataSources.name],
        })
        .returning({
          createdAt: dataSources.createdAt,
          id: dataSources.id,
          name: dataSources.name,
          provider: dataSources.provider,
          status: dataSources.status,
          updatedAt: dataSources.updatedAt,
        });

      if (!inserted) {
        return c.json(
          {
            error: {
              code: DATA_SOURCE_NAME_DUPLICATE_CODE,
              message: DATA_SOURCE_NAME_CONFLICT_MESSAGE,
            },
          },
          409
        );
      }

      return c.json({ dataSource: inserted }, 201);
    }
  )

  .patch(
    "/:id",
    requireOrgAccess(),
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    zValidator("json", UpdateDataSourceSchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);

      const existing = await db.query.dataSources.findFirst({
        where: and(
          eq(dataSources.id, id),
          eq(dataSources.organizationId, organizationId)
        ),
      });

      if (!existing) {
        return c.json({ error: "Data source not found" }, 404);
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (body.name) {
        if (body.name !== existing.name) {
          const nameConflict = await db.query.dataSources.findFirst({
            columns: { id: true },
            where: and(
              eq(dataSources.organizationId, organizationId),
              eq(dataSources.name, body.name),
              ne(dataSources.id, id)
            ),
          });

          if (nameConflict) {
            return c.json(
              {
                error: {
                  code: DATA_SOURCE_NAME_DUPLICATE_CODE,
                  message: DATA_SOURCE_NAME_CONFLICT_MESSAGE,
                },
              },
              409
            );
          }
        }

        updates.name = body.name;
      }

      if (body.credentials) {
        if (
          !doesProviderMatchCredentials({
            credentialsType: body.credentials.type,
            provider: existing.provider,
          })
        ) {
          return c.json(
            {
              error: "Credentials type does not match data source provider",
            },
            400
          );
        }

        if (
          isUnsupportedGoogleOAuthCredentials({
            credentials: body.credentials,
            provider: existing.provider,
          })
        ) {
          return c.json({ error: GOOGLE_OAUTH_DATA_SOURCE_ERROR }, 400);
        }

        if (
          existing.provider === "aws_athena_connector" &&
          body.credentials.type === "aws_athena_connector"
        ) {
          const organizationCheck = await ensureConnectorOrganization({
            connectorId: body.credentials.connectorId,
            db,
            organizationId,
          });
          if (!organizationCheck.ok) {
            return c.json(
              { error: organizationCheck.error },
              organizationCheck.status
            );
          }
        }

        const encrypted = encryptCredentialsObject(
          body.credentials,
          c.var.runtime.crypto.masterEncryptionKey
        );
        updates.credentialsEncrypted = encrypted.ciphertext;
        updates.credentialsIv = encrypted.iv;
      }

      if (typeof body.useAsDataSource === "boolean") {
        updates.useAsDataSource = body.useAsDataSource;
      }

      try {
        await db
          .update(dataSources)
          .set(updates)
          .where(
            and(
              eq(dataSources.id, id),
              eq(dataSources.organizationId, organizationId)
            )
          );
      } catch (error) {
        if (isDataSourceNameConflict(error)) {
          return c.json(
            {
              error: {
                code: DATA_SOURCE_NAME_DUPLICATE_CODE,
                message: DATA_SOURCE_NAME_CONFLICT_MESSAGE,
              },
            },
            409
          );
        }

        throw error;
      }

      return c.json({ success: true });
    }
  )

  .delete(
    "/:id",
    requireOrgAccess(),
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const id = c.req.param("id");
      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);

      const existing = await db.query.dataSources.findFirst({
        where: and(
          eq(dataSources.id, id),
          eq(dataSources.organizationId, organizationId)
        ),
      });

      if (!existing) {
        return c.json({ error: "Data source not found" }, 404);
      }

      if (existing.provider === "linear") {
        const decryptOutcome = await Promise.resolve()
          .then(() =>
            decryptCredentialsObject(
              existing.credentialsEncrypted,
              existing.credentialsIv,
              c.var.runtime.crypto.masterEncryptionKey,
              credentialSchemaMap.linear
            )
          )
          .then((credentials) => ({ credentials, ok: true as const }))
          .catch((error: unknown) => ({ error, ok: false as const }));

        if (decryptOutcome.ok) {
          const revokeOutcome = await revokeLinearToken({
            token: getLinearRevocationToken(decryptOutcome.credentials),
          });
          if (!revokeOutcome.ok) {
            console.warn(
              "[data-sources] Failed to revoke Linear token during disconnect",
              {
                dataSourceId: existing.id,
                error: revokeOutcome.error,
              }
            );
          }
        }

        if (!decryptOutcome.ok) {
          console.warn(
            "[data-sources] Failed to decrypt Linear credentials during disconnect",
            {
              dataSourceId: existing.id,
              error:
                decryptOutcome.error instanceof Error
                  ? decryptOutcome.error.message
                  : String(decryptOutcome.error),
            }
          );
        }
      }

      await db
        .delete(dataSources)
        .where(
          and(
            eq(dataSources.id, id),
            eq(dataSources.organizationId, organizationId)
          )
        );

      return c.json({ success: true });
    }
  );
