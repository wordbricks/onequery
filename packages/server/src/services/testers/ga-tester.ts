import type { GoogleAnalyticsCredentials } from "@onequery/db/server";

import {
  resolveGoogleAnalyticsAccessToken,
  resolveGoogleAnalyticsPropertyPath,
  runGoogleAnalyticsDataRequest,
} from "../google-analytics/relay";
import { createHttpTester } from "./create-http-tester";
import { parseHttpStatusError } from "./parse-http-error";

const REQUEST_TIMEOUT_PREFIX = "Google Analytics request timeout after ";

function withTimeout<T>(
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

export const testGoogleAnalyticsConnection =
  createHttpTester<GoogleAnalyticsCredentials>({
    parseError: (error, latencyMs, timeoutSeconds) => {
      if (error.message.startsWith(REQUEST_TIMEOUT_PREFIX)) {
        return {
          error: `Connection timed out after ${timeoutSeconds} seconds`,
          latencyMs,
          message: "Connection timed out",
          success: false,
        };
      }

      return parseHttpStatusError(error, latencyMs, timeoutSeconds, {
        accessDeniedError:
          "Google credentials do not have access to this property",
        authenticationError: "Invalid or expired Google Analytics credentials",
      });
    },
    probe: async (credentials, timeoutMs) => {
      const propertyPath = resolveGoogleAnalyticsPropertyPath({
        credentials,
        request: {},
      });
      if (!propertyPath) {
        throw new Error(
          "Property ID is required in saved data source credentials"
        );
      }

      const timeoutMessage = `${REQUEST_TIMEOUT_PREFIX}${timeoutMs}ms`;
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
            limit: 1,
            metrics: [{ name: "activeUsers" }],
          },
        }),
        timeoutMs,
        timeoutMessage
      );

      if (response.ok) {
        return response;
      }

      const detail = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Google Analytics API error (${response.status}): ${detail}`
      );
    },
  });
