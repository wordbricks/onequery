import type { SentryCredentials } from "@onequery/db/server";

import { fetchSentryApi, listSentryProjects } from "../sentry/relay";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";
import type { ConnectionTestResult } from "./postgres-tester";

const SENTRY_ERROR_PATTERN = /^Sentry API error \((\d{3})\):\s*([\s\S]*)$/;
const SENTRY_TIMEOUT_PREFIX = "Sentry request timeout after ";

function toFailureResult(input: {
  error: unknown;
  latencyMs: number;
  timeoutSeconds: number;
  projectSlug?: string;
}): ConnectionTestResult {
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error);

  if (errorMessage.startsWith(SENTRY_TIMEOUT_PREFIX)) {
    return {
      error: `Connection timed out after ${input.timeoutSeconds} seconds`,
      latencyMs: input.latencyMs,
      message: "Connection timed out",
      success: false,
    };
  }

  const matched = errorMessage.match(SENTRY_ERROR_PATTERN);
  if (matched) {
    const [, statusCodeText, detailText] = matched;
    if (!statusCodeText) {
      return {
        error: errorMessage,
        latencyMs: input.latencyMs,
        message: "Connection failed",
        success: false,
      };
    }

    const statusCode = Number.parseInt(statusCodeText, 10);
    const detail = detailText?.trim() || "Unknown error";

    if (statusCode === 401) {
      return {
        error: "Invalid auth token",
        latencyMs: input.latencyMs,
        message: "Authentication failed",
        success: false,
      };
    }

    if (statusCode === 403) {
      return {
        error: "Auth token does not have the required Sentry permissions",
        latencyMs: input.latencyMs,
        message: "Access denied",
        success: false,
      };
    }

    if (statusCode === 404) {
      return {
        error: input.projectSlug
          ? "Project slug not found or not accessible"
          : "Organization slug not found or not accessible",
        latencyMs: input.latencyMs,
        message: input.projectSlug
          ? "Invalid Project Slug"
          : "Invalid Organization Slug",
        success: false,
      };
    }

    return {
      error: `HTTP ${statusCode}: ${detail}`,
      latencyMs: input.latencyMs,
      message: "Connection failed",
      success: false,
    };
  }

  return {
    error: errorMessage,
    latencyMs: input.latencyMs,
    message: "Connection failed",
    success: false,
  };
}

export async function testSentryConnection(
  credentials: SentryCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));

  try {
    if (credentials.projectSlug) {
      await fetchSentryApi({
        credentials,
        endpoint: "/projects/{organizationSlug}/{projectSlug}/events/",
        options: {
          method: "GET",
          params: {
            full: false,
            statsPeriod: "24h",
          },
          timeoutMs,
        },
      });
    } else {
      await listSentryProjects({
        credentials,
        options: {
          method: "GET",
          timeoutMs,
        },
      });
    }

    const latencyMs = Date.now() - startTime;
    return {
      latencyMs,
      message: `Connection successful (${latencyMs}ms)`,
      success: true,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return toFailureResult({
      error,
      latencyMs,
      projectSlug: credentials.projectSlug,
      timeoutSeconds,
    });
  }
}
