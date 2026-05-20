import type { Credentials, Database } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import {
  DataSourceQueryExecutionError,
  executeDatabaseQuery,
} from "./data-source-query/execute-query";
import { testAmplitudeConnection } from "./testers/amplitude-tester";
import {
  ConnectionTestFailure,
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
  createTimedOutConnectionTest,
} from "./testers/connection-test-outcome";
import type {
  ConnectionTestOutcome,
  ConnectionTestSuccess,
} from "./testers/connection-test-outcome";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./testers/defaults";
import { testGoogleAnalyticsConnection } from "./testers/ga-tester";
import { testMixpanelConnection } from "./testers/mixpanel-tester";
import { testMySQLConnection } from "./testers/mysql-tester";
import { testPostgresConnection } from "./testers/postgres-tester";
import { testPostHogConnection } from "./testers/posthog-tester";
import { testSentryConnection } from "./testers/sentry-tester";

export type UnsupportedTestReason = "oauth" | "not_implemented";

export class UnsupportedDataSourceTestError extends TaggedError(
  "UnsupportedDataSourceTestError"
)<{
  message: string;
  reason: UnsupportedTestReason;
}>() {}

export type DataSourceTestOutcome = ResultType<
  ConnectionTestSuccess,
  ConnectionTestFailure | UnsupportedDataSourceTestError
>;

const OAUTH_UNSUPPORTED_MESSAGE =
  "Testing is not supported for OAuth-based providers. They are tested during the authorization flow.";
const GENERIC_UNSUPPORTED_MESSAGE =
  "Testing is not supported for this provider.";
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

type DataSourceTestOptions = {
  timeoutSeconds?: number;
  organizationId?: string;
  db?: Database;
};

const DIRECT_CONNECTION_TESTERS: Partial<
  Record<
    Credentials["type"],
    (
      credentials: Credentials,
      options: DataSourceTestOptions
    ) => Promise<DataSourceTestOutcome>
  >
> = {
  amplitude: async (credentials, options): Promise<DataSourceTestOutcome> =>
    testAmplitudeConnection(
      credentials as Extract<Credentials, { type: "amplitude" }>,
      options.timeoutSeconds
    ),
  mixpanel: async (credentials, options): Promise<DataSourceTestOutcome> =>
    testMixpanelConnection(
      credentials as Extract<Credentials, { type: "mixpanel" }>,
      options.timeoutSeconds
    ),
  mongodb: async (credentials, options): Promise<DataSourceTestOutcome> => {
    const { testMongoConnection } = await import("./testers/mongodb-tester");
    return testMongoConnection(
      credentials as Extract<Credentials, { type: "mongodb" }>,
      options.timeoutSeconds
    );
  },
  mysql: async (credentials, options): Promise<DataSourceTestOutcome> =>
    testMySQLConnection(
      credentials as Extract<Credentials, { type: "mysql" }>,
      options.timeoutSeconds
    ),
  postgres: async (credentials, options): Promise<DataSourceTestOutcome> =>
    testPostgresConnection(
      credentials as Extract<Credentials, { type: "postgres" }>,
      options.timeoutSeconds
    ),
  posthog: async (credentials, options): Promise<DataSourceTestOutcome> =>
    testPostHogConnection(
      credentials as Extract<Credentials, { type: "posthog" }>,
      options.timeoutSeconds
    ),
  sentry: async (credentials, options): Promise<DataSourceTestOutcome> =>
    testSentryConnection(
      credentials as Extract<Credentials, { type: "sentry" }>,
      options.timeoutSeconds
    ),
};

export async function testDataSource(
  credentials: Credentials,
  options: DataSourceTestOptions = {}
): Promise<DataSourceTestOutcome> {
  const directTester =
    DIRECT_CONNECTION_TESTERS[
      credentials.type as keyof typeof DIRECT_CONNECTION_TESTERS
    ];
  if (directTester) {
    return directTester(credentials, options);
  }

  if (credentials.type === "ga") {
    if (credentials.authType === "oauth") {
      return Result.err(
        new UnsupportedDataSourceTestError({
          message: OAUTH_UNSUPPORTED_MESSAGE,
          reason: "oauth",
        })
      );
    }
    return testGoogleAnalyticsConnection(credentials, options.timeoutSeconds);
  }

  if (credentials.type === "bigquery") {
    if (credentials.authType === "oauth") {
      return Result.err(
        new UnsupportedDataSourceTestError({
          message: OAUTH_UNSUPPORTED_MESSAGE,
          reason: "oauth",
        })
      );
    }
    return testBigQueryConnection(credentials, {
      timeoutSeconds: options.timeoutSeconds,
    });
  }

  if (credentials.type === "aws_athena_connector") {
    return testConnectorConnection(credentials, {
      db: options.db,
      organizationId: options.organizationId,
      timeoutSeconds: options.timeoutSeconds,
    });
  }

  if (credentials.type === "cloudflare_d1") {
    return testCloudflareD1Connection(credentials, {
      timeoutSeconds: options.timeoutSeconds,
    });
  }

  const reason = getUnsupportedReason(credentials);
  return Result.err(
    new UnsupportedDataSourceTestError({
      message: buildUnsupportedMessage(reason),
      reason,
    })
  );
}

export function serializeDataSourceTestOutcome(outcome: DataSourceTestOutcome):
  | {
      kind: "supported";
      result:
        | {
            success: true;
            message: string;
            latencyMs: number;
          }
        | {
            success: false;
            message: string;
            error: string;
            latencyMs: number;
          };
    }
  | {
      kind: "unsupported";
      reason: UnsupportedTestReason;
      message: string;
    } {
  if (outcome.isOk()) {
    return {
      kind: "supported",
      result: {
        latencyMs: outcome.value.latencyMs,
        message: outcome.value.message,
        success: true,
      },
    };
  }

  if (UnsupportedDataSourceTestError.is(outcome.error)) {
    return {
      kind: "unsupported",
      message: outcome.error.message,
      reason: outcome.error.reason,
    };
  }

  return {
    kind: "supported",
    result: {
      error: outcome.error.detail,
      latencyMs: outcome.error.latencyMs,
      message: outcome.error.message,
      success: false,
    },
  };
}

function getUnsupportedReason(credentials: Credentials): UnsupportedTestReason {
  if (credentials.type === "github") {
    return "oauth";
  }
  return "not_implemented";
}

function buildUnsupportedMessage(reason: UnsupportedTestReason): string {
  if (reason === "oauth") {
    return OAUTH_UNSUPPORTED_MESSAGE;
  }
  return GENERIC_UNSUPPORTED_MESSAGE;
}

async function testConnectorConnection(
  credentials: Extract<Credentials, { type: "aws_athena_connector" }>,
  options: {
    db?: Database;
    timeoutSeconds?: number;
    organizationId?: string;
  }
): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();

  if (!options.organizationId) {
    return Result.err(
      createFailedConnectionTest({
        detail: "Organization ID is required for connector test.",
        latencyMs: Date.now() - startTime,
      })
    );
  }

  return runQueryConnectionTest({
    execute: async (timeoutMs) =>
      executeDatabaseQuery({
        ...(options.db ? { db: options.db } : {}),
        credentials,
        sql: CONNECTION_TEST_QUERY,
        timeoutMs,
        organizationId: options.organizationId,
      }),
    startTime,
    timeoutSeconds: options.timeoutSeconds,
  });
}

async function testCloudflareD1Connection(
  credentials: Extract<Credentials, { type: "cloudflare_d1" }>,
  options: {
    timeoutSeconds?: number;
  }
): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();

  return runQueryConnectionTest({
    execute: async (timeoutMs) => {
      await executeDatabaseQuery({
        credentials,
        sql: CONNECTION_TEST_QUERY,
        timeoutMs,
      });
    },
    mapError: (error, latencyMs) => {
      const statusCode = readCloudflareD1StatusCode(error);
      if (statusCode === 401) {
        return createFailedConnectionTest({
          detail: "Invalid or expired Cloudflare credentials",
          latencyMs,
          message: "Authentication failed",
        });
      }
      if (statusCode === 403) {
        return createFailedConnectionTest({
          detail:
            "Cloudflare credentials do not have access to this D1 database",
          latencyMs,
          message: "Access denied",
        });
      }

      return null;
    },
    startTime,
    timeoutSeconds: options.timeoutSeconds,
  });
}

async function testBigQueryConnection(
  credentials: Extract<Credentials, { type: "bigquery" }>,
  options: {
    timeoutSeconds?: number;
  }
): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();

  return runQueryConnectionTest({
    execute: async (timeoutMs) => {
      await executeDatabaseQuery({
        credentials,
        sql: CONNECTION_TEST_QUERY,
        timeoutMs,
      });
    },
    mapError: (error, latencyMs) => {
      const statusCode = readBigQueryStatusCode(error);
      if (statusCode === 401) {
        return createFailedConnectionTest({
          detail: "Invalid or expired BigQuery credentials",
          latencyMs,
          message: "Authentication failed",
        });
      }
      if (statusCode === 403) {
        return createFailedConnectionTest({
          detail: "BigQuery credentials do not have access to this project",
          latencyMs,
          message: "Access denied",
        });
      }

      return null;
    },
    startTime,
    timeoutSeconds: options.timeoutSeconds,
  });
}

async function runQueryConnectionTest(input: {
  startTime: number;
  timeoutSeconds?: number;
  execute: (timeoutMs: number) => Promise<unknown>;
  mapError?: (
    error: unknown,
    latencyMs: number
  ) => ConnectionTestFailure | null;
}): Promise<ConnectionTestOutcome> {
  const timeoutMs = resolveConnectionTestTimeoutMs(input.timeoutSeconds);

  const execution = await Result.tryPromise(async () =>
    input.execute(timeoutMs)
  );
  if (execution.isOk()) {
    return Result.ok(
      createSuccessfulConnectionTest(Date.now() - input.startTime)
    );
  }
  const latencyMs = Date.now() - input.startTime;
  if (
    execution.error instanceof DataSourceQueryExecutionError &&
    execution.error.timedOut
  ) {
    return Result.err(createTimedOutConnectionTest(timeoutMs, latencyMs));
  }

  const mappedResult = input.mapError?.(execution.error, latencyMs);
  if (mappedResult) {
    return Result.err(mappedResult);
  }

  return Result.err(
    createFailedConnectionTest({
      detail: readErrorMessage(execution.error),
      latencyMs,
    })
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveConnectionTestTimeoutMs(
  timeoutSeconds: number | undefined
): number {
  return Math.max(
    1000,
    Math.round(
      (timeoutSeconds ?? DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS) * 1000
    )
  );
}

function readBigQueryStatusCode(error: unknown): number | null {
  const message = readErrorMessage(error);
  const match = /BigQuery API request failed: (\d{3})\b/u.exec(message);
  if (!match) {
    return null;
  }

  const statusCode = Number(match[1]);
  return Number.isInteger(statusCode) ? statusCode : null;
}

function readCloudflareD1StatusCode(error: unknown): number | null {
  const message = readErrorMessage(error);
  const match = /Cloudflare D1 query failed: (\d{3})\b/u.exec(message);
  if (!match) {
    return null;
  }

  const statusCode = Number(match[1]);
  return Number.isInteger(statusCode) ? statusCode : null;
}
