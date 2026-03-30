import type { GoogleAnalyticsCredentials } from "@onequery/db/server";

import {
  resolveGoogleAnalyticsAccessToken,
  resolveGoogleAnalyticsPropertyPath,
  runGoogleAnalyticsDataRequest,
} from "../google-analytics/relay";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";
import type { ConnectionTestResult } from "./postgres-tester";

const REQUEST_TIMEOUT_PREFIX = "Google Analytics request timeout after ";

type TestGoogleAnalyticsConnectionOptions = {
  timeoutSeconds?: number;
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs
    );
    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

export async function testGoogleAnalyticsConnection(
  credentials: GoogleAnalyticsCredentials,
  options: TestGoogleAnalyticsConnectionOptions = {}
): Promise<ConnectionTestResult> {
  const timeoutSeconds =
    options.timeoutSeconds ?? DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS;
  const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));
  const startTime = Date.now();
  const timeoutMessage = `${REQUEST_TIMEOUT_PREFIX}${timeoutMs}ms`;

  const propertyPath = resolveGoogleAnalyticsPropertyPath({
    credentials,
    request: {},
  });
  if (!propertyPath) {
    return {
      error: "Property ID is required in saved data source credentials",
      latencyMs: Date.now() - startTime,
      message: "Connection failed",
      success: false,
    };
  }

  try {
    const tokenResult = await withTimeout(
      resolveGoogleAnalyticsAccessToken({
        credentials,
      }),
      timeoutMs,
      timeoutMessage
    );
    const response = await withTimeout(
      runGoogleAnalyticsDataRequest({
        accessToken: tokenResult.accessToken,
        method: "run_report",
        propertyPath,
        requestBody: {
          dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
          metrics: [{ name: "activeUsers" }],
          limit: 1,
        },
      }),
      timeoutMs,
      timeoutMessage
    );
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        latencyMs,
        message: `Connection successful (${latencyMs}ms)`,
        success: true,
      };
    }

    const errorText = await response.text().catch(() => "Unknown error");
    if (response.status === 401) {
      return {
        error: "Invalid or expired Google Analytics credentials",
        latencyMs,
        message: "Authentication failed",
        success: false,
      };
    }
    if (response.status === 403) {
      return {
        error: "Google credentials do not have access to this property",
        latencyMs,
        message: "Access denied",
        success: false,
      };
    }

    return {
      error: `HTTP ${response.status}: ${errorText}`,
      latencyMs,
      message: "Connection failed",
      success: false,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.startsWith(REQUEST_TIMEOUT_PREFIX)) {
      return {
        error: `Connection timed out after ${timeoutSeconds} seconds`,
        latencyMs,
        message: "Connection timed out",
        success: false,
      };
    }
    return {
      error: errorMessage,
      latencyMs,
      message: "Connection failed",
      success: false,
    };
  }
}
