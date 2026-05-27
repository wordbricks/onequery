import { dataSourceQueryCosts } from "@onequery/db/server";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runCliExecuteSqlEffect,
  runCliLoadQueryCredentialsEffect,
  runCliValidateQueryEffect,
} from "./effects";
import type { CliQueryEffectDependencies } from "./effects";

describe("query effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes Google OAuth config to credential preparation", async () => {
    const prepareDataSourceCredentials =
      vi.fn<CliQueryEffectDependencies["prepareDataSourceCredentials"]>();
    prepareDataSourceCredentials.mockResolvedValueOnce(
      Result.ok({
        credentials: {
          database: "app",
          host: "localhost",
          password: "secret",
          port: 5432,
          sslMode: "prefer",
          type: "postgres",
          username: "onequery",
        },
        refreshed: false,
      })
    );

    const db = {};
    const source = {
      credentialsEncrypted: "encrypted",
      credentialsIv: "iv",
      displayName: null,
      id: "source_1",
      name: "warehouse",
      organizationId: "org_1",
      provider: "postgres",
      sourceKey: "warehouse",
      status: "active",
    } as const;

    const result = await runCliLoadQueryCredentialsEffect({
      db: db as never,
      effect: {
        kind: "load_credentials",
        source,
      },
      dependencies: {
        prepareDataSourceCredentials,
      },
      googleOAuthConfig: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
      },
      masterEncryptionKey: new Uint8Array(32),
    });

    expect(result.kind).toBe("credentials_loaded");
    expect(prepareDataSourceCredentials).toHaveBeenCalledWith({
      dataSource: source,
      db,
      googleOAuthConfig: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
      },
      masterEncryptionKey: new Uint8Array(32),
    });
  });

  it("validates postgres SQL through the production validator", async () => {
    await expect(
      runCliValidateQueryEffect({
        databaseType: "postgres",
        kind: "validate_query",
        sql: "select id from users limit 10;",
      })
    ).resolves.toMatchObject({
      kind: "query_ready",
      normalizedSql: "select id from users limit 10;",
    });
  });

  it("persists BigQuery query cost stats after successful execution", async () => {
    const values = vi.fn(() => Promise.resolve());
    const insert = vi.fn(() => ({ values }));
    const db = { insert };
    const executeBigQueryQueryWithStats =
      vi.fn<CliQueryEffectDependencies["executeBigQueryQueryWithStats"]>();
    executeBigQueryQueryWithStats.mockResolvedValueOnce(
      Result.ok({
        rows: [{ total: 1 }],
        stats: {
          actualCostUsd: 0.01,
          actualProcessedBytes: 2048n,
          billableBytes: 2048n,
          cacheHit: false,
          currency: "USD",
          estimatedCostUsd: 0.02,
          estimatedProcessedBytes: 4096n,
          jobId: "job_1",
          location: "US",
          pricingModel: "on_demand",
          provider: "bigquery",
        },
      })
    );

    const result = await runCliExecuteSqlEffect({
      db: db as never,
      effect: {
        actionId: "action_1",
        clientTimeoutMs: 30_000,
        credentials: {
          authType: "service_account",
          projectId: "project_1",
          serviceAccount: {
            clientEmail: "svc@example.com",
            privateKey: "private-key",
            projectId: "project_1",
          },
          type: "bigquery",
        },
        kind: "execute_sql",
        normalizedSql: "select 1",
        requestId: "request_1",
        source: {
          credentialsEncrypted: "encrypted",
          credentialsIv: "iv",
          displayName: null,
          id: "source_1",
          name: "warehouse",
          organizationId: "org_1",
          provider: "bigquery",
          sourceKey: "warehouse",
          status: "active",
        },
      },
      dependencies: {
        executeBigQueryQueryWithStats,
        executeDatabaseQueryWithStats:
          vi.fn<CliQueryEffectDependencies["executeDatabaseQueryWithStats"]>(),
        executeValidatedDatabaseQuery:
          vi.fn<CliQueryEffectDependencies["executeValidatedDatabaseQuery"]>(),
      },
    });

    expect(result).toMatchObject({
      kind: "succeeded",
      rows: [{ total: 1 }],
    });
    expect(executeBigQueryQueryWithStats).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bigquery" }),
      "select 1",
      { timeoutMs: 30_000 }
    );
    expect(insert).toHaveBeenCalledWith(dataSourceQueryCosts);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionName: "warehouse",
        jobId: "job_1",
        organizationId: "org_1",
        provider: "bigquery",
        queryId: "action_1",
        toolCallId: "action_1",
      })
    );
  });
});
