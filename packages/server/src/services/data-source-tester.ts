import type { Credentials, Database } from "@onequery/db/server";

import {
  DataSourceQueryExecutionError,
  executeDatabaseQuery,
} from "./data-source-query/execute-query";
import { testAmplitudeConnection } from "./testers/amplitude-tester";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./testers/defaults";
import { testGoogleAnalyticsConnection } from "./testers/ga-tester";
import { testMixpanelConnection } from "./testers/mixpanel-tester";
import { testMySQLConnection } from "./testers/mysql-tester";
import type { ConnectionTestResult } from "./testers/mysql-tester";
import { testPostgresConnection } from "./testers/postgres-tester";
import { testPostHogConnection } from "./testers/posthog-tester";
import { testSentryConnection } from "./testers/sentry-tester";

export type UnsupportedTestReason = "oauth" | "not_implemented";

export type DataSourceTestResult =
  | { kind: "supported"; result: ConnectionTestResult }
  | { kind: "unsupported"; reason: UnsupportedTestReason; message: string };

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
    ) => Promise<DataSourceTestResult>
  >
> = {
  amplitude: async (
    credentials,
    options: DataSourceTestOptions
  ): Promise<DataSourceTestResult> => ({
    kind: "supported",
    result: await testAmplitudeConnection(
      credentials as Extract<Credentials, { type: "amplitude" }>,
      options.timeoutSeconds
    ),
  }),
  mixpanel: async (
    credentials,
    options: DataSourceTestOptions
  ): Promise<DataSourceTestResult> => ({
    kind: "supported",
    result: await testMixpanelConnection(
      credentials as Extract<Credentials, { type: "mixpanel" }>,
      options.timeoutSeconds
    ),
  }),
  mongodb: async (
    credentials,
    options: DataSourceTestOptions
  ): Promise<DataSourceTestResult> => {
    const { testMongoConnection } = await import("./testers/mongodb-tester");
    return {
      kind: "supported",
      result: await testMongoConnection(
        credentials as Extract<Credentials, { type: "mongodb" }>,
        options.timeoutSeconds
      ),
    };
  },
  mysql: async (
    credentials,
    options: DataSourceTestOptions
  ): Promise<DataSourceTestResult> => ({
    kind: "supported",
    result: await testMySQLConnection(
      credentials as Extract<Credentials, { type: "mysql" }>,
      options.timeoutSeconds
    ),
  }),
  postgres: async (
    credentials,
    options: DataSourceTestOptions
  ): Promise<DataSourceTestResult> => ({
    kind: "supported",
    result: await testPostgresConnection(
      credentials as Extract<Credentials, { type: "postgres" }>,
      options.timeoutSeconds
    ),
  }),
  posthog: async (
    credentials,
    options: DataSourceTestOptions
  ): Promise<DataSourceTestResult> => ({
    kind: "supported",
    result: await testPostHogConnection(
      credentials as Extract<Credentials, { type: "posthog" }>,
      options.timeoutSeconds
    ),
  }),
  sentry: async (
    credentials,
    options: DataSourceTestOptions
  ): Promise<DataSourceTestResult> => ({
    kind: "supported",
    result: await testSentryConnection(
      credentials as Extract<Credentials, { type: "sentry" }>,
      options.timeoutSeconds
    ),
  }),
};

export async function testDataSource(
  credentials: Credentials,
  options: DataSourceTestOptions = {}
): Promise<DataSourceTestResult> {
  const directTester =
    DIRECT_CONNECTION_TESTERS[
      credentials.type as keyof typeof DIRECT_CONNECTION_TESTERS
    ];
  if (directTester) {
    return directTester(credentials, options);
  }

  if (credentials.type === "ga") {
    if (credentials.authType === "oauth") {
      return {
        kind: "unsupported",
        message: OAUTH_UNSUPPORTED_MESSAGE,
        reason: "oauth",
      };
    }
    return {
      kind: "supported",
      result: await testGoogleAnalyticsConnection(
        credentials,
        options.timeoutSeconds
      ),
    };
  }

  if (credentials.type === "bigquery") {
    if (credentials.authType === "oauth") {
      return {
        kind: "unsupported",
        message: OAUTH_UNSUPPORTED_MESSAGE,
        reason: "oauth",
      };
    }
    return {
      kind: "supported",
      result: await testBigQueryConnection(credentials, {
        timeoutSeconds: options.timeoutSeconds,
      }),
    };
  }

  if (credentials.type === "aws_athena_connector") {
    return {
      kind: "supported",
      result: await testConnectorConnection(credentials, {
        db: options.db,
        organizationId: options.organizationId,
        timeoutSeconds: options.timeoutSeconds,
      }),
    };
  }

  const reason = getUnsupportedReason(credentials);
  const message = buildUnsupportedMessage(reason);
  return { kind: "unsupported", message, reason };
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
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  if (!options.organizationId) {
    return {
      error: "Organization ID is required for connector test.",
      message: "Connection failed",
      success: false,
    };
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

async function testBigQueryConnection(
  credentials: Extract<Credentials, { type: "bigquery" }>,
  options: {
    timeoutSeconds?: number;
  }
): Promise<ConnectionTestResult> {
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
        return {
          success: false,
          message: "Authentication failed",
          error: "Invalid or expired BigQuery credentials",
          latencyMs,
        };
      }
      if (statusCode === 403) {
        return {
          success: false,
          message: "Access denied",
          error: "BigQuery credentials do not have access to this project",
          latencyMs,
        };
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
  mapError?: (error: unknown, latencyMs: number) => ConnectionTestResult | null;
}): Promise<ConnectionTestResult> {
  const timeoutMs = resolveConnectionTestTimeoutMs(input.timeoutSeconds);

  try {
    await input.execute(timeoutMs);

    return createSuccessfulConnectionTestResult(Date.now() - input.startTime);
  } catch (error) {
    const latencyMs = Date.now() - input.startTime;
    if (error instanceof DataSourceQueryExecutionError && error.timedOut) {
      return createTimedOutConnectionTestResult(timeoutMs, latencyMs);
    }

    const mappedResult = input.mapError?.(error, latencyMs);
    if (mappedResult) {
      return mappedResult;
    }

    return createFailedConnectionTestResult(readErrorMessage(error), latencyMs);
  }
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

function createSuccessfulConnectionTestResult(
  latencyMs: number
): ConnectionTestResult {
  return {
    latencyMs,
    message: `Connection successful (${latencyMs}ms)`,
    success: true,
  };
}

function createTimedOutConnectionTestResult(
  timeoutMs: number,
  latencyMs: number
): ConnectionTestResult {
  return {
    error: `Connection timed out after ${Math.round(timeoutMs / 1_000)} seconds`,
    latencyMs,
    message: "Connection timed out",
    success: false,
  };
}

function createFailedConnectionTestResult(
  error: string,
  latencyMs: number
): ConnectionTestResult {
  return {
    error,
    latencyMs,
    message: "Connection failed",
    success: false,
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
