import { zValidator } from "@hono/zod-validator";
import { DATA_SOURCE_NAME_DUPLICATE_CODE } from "@onequery/db/constants";
import {
  and,
  credentialSchemaMap,
  dataSources,
  doesSourceProviderMatchCredentials,
  eq,
  getLinearAccessMode,
  getSourceProviderDefinition,
  isSourceProviderId,
  ne,
} from "@onequery/db/server";
import type {
  Credentials,
  LinearAccessMode,
  ProviderType,
} from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { Hono } from "hono";

import {
  DATA_SOURCE_NAME_CONFLICT_MESSAGE,
  isDataSourceNameConflict,
} from "../../lib/db-errors";
import { verifyOrgAccess } from "../../lib/verify-org-access";
import type { BetterAuthSessionVariables } from "../../middleware/better-auth-session";
import { requireOrgAccess } from "../../middleware/require-org-access";
import { zodProblemHook } from "../../problem-details/zod-problem-hook";
import type { ServerRuntimeVariables } from "../../runtime-context";
import { ensureConnectorOrganization } from "../../services/connectors/broker";
import {
  decryptCredentialsObjectResult,
  encryptCredentialsObject,
} from "../../services/crypto/credential-encryption";
import {
  CreateDataSourceSchema,
  OrgQuerySchema,
  UpdateDataSourceSchema,
} from "./schemas";

const GOOGLE_OAUTH_DATA_SOURCE_ERROR =
  "Google Analytics and BigQuery data sources must use service account credentials.";

class LinearTokenRevocationError extends TaggedError(
  "LinearTokenRevocationError"
)<{
  message: string;
  cause?: unknown;
}>() {}

class LinearCredentialsDecryptError extends TaggedError(
  "LinearCredentialsDecryptError"
)<{
  message: string;
  cause: unknown;
}>() {}

function injectProviderCredentialType(input: {
  credentials: unknown;
  credentialType: string;
}): unknown {
  if (
    typeof input.credentials !== "object" ||
    input.credentials === null ||
    Array.isArray(input.credentials)
  ) {
    return input.credentials;
  }

  return {
    ...input.credentials,
    type: input.credentialType,
  };
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

function readLinearAccessModeMetadata(input: {
  dataSource: {
    credentialsEncrypted: string;
    credentialsIv: string;
    id: string;
    provider: ProviderType;
  };
  masterKey: Uint8Array;
}): LinearAccessMode | undefined {
  if (input.dataSource.provider !== "linear") {
    return undefined;
  }

  const credentials = decryptCredentialsObjectResult(
    input.dataSource.credentialsEncrypted,
    input.dataSource.credentialsIv,
    input.masterKey,
    credentialSchemaMap.linear
  );

  if (credentials.isErr()) {
    console.warn("[data-sources] Failed to read Linear access mode", {
      dataSourceId: input.dataSource.id,
      error: credentials.error.message,
    });
    return undefined;
  }

  return getLinearAccessMode(credentials.value);
}

function parseProviderCredentials(input: {
  provider: string;
  credentials: unknown;
}): ResultType<
  { provider: ProviderType; credentials: Credentials },
  { status: 400; body: { error: string; details?: string } }
> {
  if (!isSourceProviderId(input.provider)) {
    return Result.err({
      status: 400,
      body: { error: `Unsupported data source provider '${input.provider}'` },
    });
  }

  const definition = getSourceProviderDefinition(input.provider);
  if (!definition) {
    return Result.err({
      status: 400,
      body: { error: `Unsupported data source provider '${input.provider}'` },
    });
  }
  const parsed = definition.credentialSchema.safeParse(
    injectProviderCredentialType({
      credentials: input.credentials,
      credentialType: definition.credentialType,
    })
  );
  if (!parsed.success) {
    return Result.err({
      status: 400,
      body: {
        error: "Invalid data source credentials",
        details: parsed.error.issues[0]?.message,
      },
    });
  }

  if (
    !doesSourceProviderMatchCredentials({
      credentialsType: parsed.data.type,
      provider: input.provider,
    })
  ) {
    return Result.err({
      status: 400,
      body: {
        details: `Provider is '${input.provider}' but credentials type is '${parsed.data.type}'`,
        error: "Provider does not match credentials type",
      },
    });
  }

  return Result.ok({
    provider: input.provider,
    credentials: parsed.data as Credentials,
  });
}

async function revokeLinearToken(input: {
  token: string;
}): Promise<ResultType<void, LinearTokenRevocationError>> {
  const body = new URLSearchParams({
    token: input.token,
    token_type_hint: "access_token",
  });

  const response = await Result.tryPromise({
    try: () =>
      fetch("https://api.linear.app/oauth/revoke", {
        body: body.toString(),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      }),
    catch: (cause) =>
      new LinearTokenRevocationError({
        cause,
        message: "Failed to reach Linear revoke endpoint",
      }),
  });
  if (response.isErr()) {
    return Result.err(response.error);
  }

  if (!response.value.ok) {
    return Result.err(
      new LinearTokenRevocationError({
        message: `Linear revoke failed with status ${response.value.status}`,
      })
    );
  }

  return Result.ok(undefined);
}

export const dataSourcesCrudRoute = new Hono<{
  Variables: ServerRuntimeVariables & BetterAuthSessionVariables;
}>()
  .get(
    "/",
    requireOrgAccess(),
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const db = c.var.storage.db;

      const result = await db.query.dataSources.findMany({
        columns: {
          id: true,
          provider: true,
          name: true,
          status: true,
          errorMessage: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
          credentialsEncrypted: true,
          credentialsIv: true,
        },
        where: eq(dataSources.organizationId, organizationId),
      });

      const publicDataSources = result.map((item) => {
        const { credentialsEncrypted, credentialsIv, ...publicDataSource } =
          item;
        const linearAccessMode = readLinearAccessModeMetadata({
          dataSource: {
            credentialsEncrypted,
            credentialsIv,
            id: item.id,
            provider: item.provider,
          },
          masterKey: c.var.runtime.crypto.masterEncryptionKey,
        });

        return {
          ...publicDataSource,
          ...(linearAccessMode ? { linearAccessMode } : {}),
        };
      });

      return c.json({ dataSources: publicDataSources });
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

      const dataSource = await db.query.dataSources.findFirst({
        columns: {
          id: true,
          provider: true,
          name: true,
          status: true,
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

      const parsedProviderCredentials = parseProviderCredentials({
        credentials: body.credentials,
        provider: body.provider,
      });
      if (parsedProviderCredentials.isErr()) {
        return c.json(
          parsedProviderCredentials.error.body,
          parsedProviderCredentials.error.status
        );
      }
      const { credentials, provider } = parsedProviderCredentials.value;

      if (isUnsupportedGoogleOAuthCredentials({ credentials, provider })) {
        return c.json({ error: GOOGLE_OAUTH_DATA_SOURCE_ERROR }, 400);
      }

      if (
        provider === "aws_athena_connector" &&
        credentials.type === "aws_athena_connector"
      ) {
        const organizationCheck = await ensureConnectorOrganization({
          connectorId: credentials.connectorId,
          db,
          organizationId: body.organizationId,
        });
        if (organizationCheck.isErr()) {
          return c.json(
            { error: organizationCheck.error.message },
            organizationCheck.error.status
          );
        }
      }

      const name = body.name;
      if (!name) {
        return c.json({ error: "Name is required" }, 400);
      }

      const encrypted = encryptCredentialsObject(
        credentials,
        c.var.runtime.crypto.masterEncryptionKey
      );

      const [inserted] = await db
        .insert(dataSources)
        .values({
          credentialsEncrypted: encrypted.ciphertext,
          credentialsIv: encrypted.iv,
          name,
          organizationId: body.organizationId,
          provider,
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

      if (body.credentials !== undefined) {
        const parsedProviderCredentials = parseProviderCredentials({
          credentials: body.credentials,
          provider: existing.provider,
        });
        if (parsedProviderCredentials.isErr()) {
          return c.json(
            parsedProviderCredentials.error.body,
            parsedProviderCredentials.error.status
          );
        }
        const { credentials } = parsedProviderCredentials.value;

        if (
          isUnsupportedGoogleOAuthCredentials({
            credentials,
            provider: existing.provider,
          })
        ) {
          return c.json({ error: GOOGLE_OAUTH_DATA_SOURCE_ERROR }, 400);
        }

        if (
          existing.provider === "aws_athena_connector" &&
          credentials.type === "aws_athena_connector"
        ) {
          const organizationCheck = await ensureConnectorOrganization({
            connectorId: credentials.connectorId,
            db,
            organizationId,
          });
          if (organizationCheck.isErr()) {
            return c.json(
              { error: organizationCheck.error.message },
              organizationCheck.error.status
            );
          }
        }

        const encrypted = encryptCredentialsObject(
          credentials,
          c.var.runtime.crypto.masterEncryptionKey
        );
        updates.credentialsEncrypted = encrypted.ciphertext;
        updates.credentialsIv = encrypted.iv;
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
        const decryptOutcome = decryptCredentialsObjectResult(
          existing.credentialsEncrypted,
          existing.credentialsIv,
          c.var.runtime.crypto.masterEncryptionKey,
          credentialSchemaMap.linear
        ).mapError(
          (cause) =>
            new LinearCredentialsDecryptError({
              cause,
              message: "Failed to decrypt Linear credentials during disconnect",
            })
        );

        if (decryptOutcome.isOk()) {
          const revokeOutcome = await revokeLinearToken({
            token: getLinearRevocationToken(decryptOutcome.value),
          });
          if (revokeOutcome.isErr()) {
            console.warn(
              "[data-sources] Failed to revoke Linear token during disconnect",
              {
                dataSourceId: existing.id,
                error: revokeOutcome.error.message,
              }
            );
          }
        }

        if (decryptOutcome.isErr()) {
          console.warn(
            "[data-sources] Failed to decrypt Linear credentials during disconnect",
            {
              dataSourceId: existing.id,
              error: decryptOutcome.error.message,
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
