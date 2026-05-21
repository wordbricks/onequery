import type { Credentials, Database } from "@onequery/db/server";
import { isDatabaseCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import {
  GENERIC_UNSUPPORTED_MESSAGE,
  OAUTH_UNSUPPORTED_MESSAGE,
  UnsupportedDataSourceTestError,
  createUnsupportedConnectionTest,
} from "./data-source-query/core/connection-test";
import type {
  DataSourceTestOutcome,
  UnsupportedTestReason,
} from "./data-source-query/core/connection-test";
import { getQueryDriver } from "./data-source-query/core/registry";
import { createQueryDeadline } from "./data-source-query/core/timeout";
import { testAmplitudeConnection } from "./testers/amplitude-tester";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./testers/defaults";
import { testGoogleAnalyticsConnection } from "./testers/ga-tester";
import { testGitHubConnection } from "./testers/github-tester";
import { testMixpanelConnection } from "./testers/mixpanel-tester";
import { testPostHogConnection } from "./testers/posthog-tester";
import { testSentryConnection } from "./testers/sentry-tester";

export { UnsupportedDataSourceTestError };
export type { DataSourceTestOutcome, UnsupportedTestReason };

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
  github: async (credentials): Promise<DataSourceTestOutcome> =>
    testGitHubConnection(
      credentials as Extract<Credentials, { type: "github" }>
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
  if (isDatabaseCredentials(credentials)) {
    const driver = getQueryDriver(credentials.type);
    return driver.testConnection({
      context: {
        db: options.db,
        organizationId: options.organizationId,
      },
      credentials: credentials as never,
      deadline: createQueryDeadline(
        resolveConnectionTestTimeoutMs(options.timeoutSeconds)
      ),
    });
  }

  const directTester =
    DIRECT_CONNECTION_TESTERS[
      credentials.type as keyof typeof DIRECT_CONNECTION_TESTERS
    ];
  if (directTester) {
    return directTester(credentials, options);
  }

  if (credentials.type === "ga") {
    if (credentials.authType === "oauth") {
      return Result.err(createUnsupportedConnectionTest("oauth"));
    }
    return testGoogleAnalyticsConnection(credentials, options.timeoutSeconds);
  }

  const reason = getUnsupportedReason(credentials);
  return Result.err(
    createUnsupportedConnectionTest(reason, buildUnsupportedMessage(reason))
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
