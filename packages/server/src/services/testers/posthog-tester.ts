import type { PostHogCredentials } from "@onequery/db/server";

import { runPostHogQuery } from "../posthog/relay";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";
import type { ConnectionTestResult } from "./postgres-tester";

const POSTHOG_ERROR_PATTERN = /^PostHog API error \((\d{3})\):\s*([\s\S]*)$/;
const POSTHOG_TIMEOUT_PREFIX = "PostHog request timeout after ";

function toFailureResult(input: {
  error: unknown;
  latencyMs: number;
  timeoutSeconds: number;
}): ConnectionTestResult {
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error);

  if (errorMessage.startsWith(POSTHOG_TIMEOUT_PREFIX)) {
    return {
      error: `Connection timed out after ${input.timeoutSeconds} seconds`,
      latencyMs: input.latencyMs,
      message: "Connection timed out",
      success: false,
    };
  }

  const matched = errorMessage.match(POSTHOG_ERROR_PATTERN);
  if (!matched) {
    return {
      error: errorMessage,
      latencyMs: input.latencyMs,
      message: "Connection failed",
      success: false,
    };
  }

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
      error: "Invalid Personal API Key",
      latencyMs: input.latencyMs,
      message: "Authentication failed",
      success: false,
    };
  }

  if (statusCode === 403) {
    return {
      error: "Personal API Key does not have access to this project",
      latencyMs: input.latencyMs,
      message: "Access denied",
      success: false,
    };
  }

  if (statusCode === 404) {
    return {
      error: "Project ID not found or Host URL is incorrect",
      latencyMs: input.latencyMs,
      message: "Invalid Project ID",
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

export async function testPostHogConnection(
  credentials: PostHogCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));

  try {
    await runPostHogQuery({
      credentials,
      query: { kind: "HogQLQuery", query: "SELECT 1" },
      refresh: "blocking",
      timeoutMs,
    });
    const latencyMs = Date.now() - startTime;
    return {
      latencyMs,
      message: `Connection successful (${latencyMs}ms)`,
      success: true,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return toFailureResult({ error, latencyMs, timeoutSeconds });
  }
}
