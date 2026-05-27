import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { createAthenaConnectorQueryExecutor } from "./driver";
import type { ConnectorAthenaJobQueue } from "./driver";

const credentials = {
  connectorId: "connector_1",
  database: "analytics",
  type: "aws_athena_connector",
  workgroup: "primary",
} as const;

describe("Athena connector query driver", () => {
  it("executes connector jobs through the injected queue", async () => {
    const queueJob = vi.fn<ConnectorAthenaJobQueue>();
    queueJob.mockResolvedValueOnce(
      Result.ok({
        columns: [{ name: "total", type: "varchar" }],
        jobId: "job_1",
        rows: [["1"]],
        stats: {
          dataScannedBytes: "1099511627776",
          executionTimeMs: 123,
          queryExecutionId: "athena_1",
          rowCount: 1,
        },
        status: "success",
      })
    );
    const executor = createAthenaConnectorQueryExecutor({ queueJob });

    const result = await executor.executeConnectorQueryWithStats(
      credentials,
      "SELECT 1",
      {
        db: { kind: "db" },
        organizationId: "org_1",
        timeoutMs: 10_000,
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        rows: [{ total: "1" }],
        stats: {
          actualCostUsd: 5,
          athenaQueryExecutionId: "athena_1",
          billableBytes: 1099511627776n,
          connectorId: "connector_1",
          connectorJobId: "job_1",
          currency: "USD",
          database: "analytics",
          executionTimeMs: 123,
          pricingModel: "per_tb_scanned",
          provider: "aws_athena_connector",
          rowCount: 1,
          workgroup: "primary",
        },
      });
    }
    expect(queueJob).toHaveBeenCalledWith({
      context: {
        db: { kind: "db" },
        organizationId: "org_1",
      },
      connectorId: "connector_1",
      database: "analytics",
      maxRows: undefined,
      organizationId: "org_1",
      sql: "SELECT 1",
      timeoutMs: 10_000,
      waitTimeoutMs: 12_000,
      workgroup: "primary",
    });
  });

  it("maps broker timeouts to query timeout failures", async () => {
    const executor = createAthenaConnectorQueryExecutor({
      queueJob: async () =>
        Result.err({
          message: "Connector job job_1 timed out after 12000ms",
          status: 504,
          timedOut: true,
        }),
    });

    const result = await executor.executeConnectorQuery(
      credentials,
      "SELECT 1",
      {
        organizationId: "org_1",
        timeoutMs: 10_000,
      }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("timed out");
    }
  });
});
