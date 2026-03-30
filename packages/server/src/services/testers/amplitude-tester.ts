import type { AmplitudeCredentials } from "@onequery/db/server";

import { fetchAmplitudeApi } from "../amplitude/relay";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";
import type { ConnectionTestResult } from "./postgres-tester";

const AMPLITUDE_ERROR_PATTERN =
  /^Amplitude API error \((\d{3})\):\s*([\s\S]*)$/;
const AMPLITUDE_TIMEOUT_PREFIX = "Amplitude request timeout after ";

function toFailureResult(input: {
  error: unknown;
  latencyMs: number;
  timeoutSeconds: number;
}): ConnectionTestResult {
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error);

  if (errorMessage.startsWith(AMPLITUDE_TIMEOUT_PREFIX)) {
    return {
      error: `Connection timed out after ${input.timeoutSeconds} seconds`,
      latencyMs: input.latencyMs,
      message: "Connection timed out",
      success: false,
    };
  }

  const matched = errorMessage.match(AMPLITUDE_ERROR_PATTERN);
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
        error: "Invalid API Key or Secret Key",
        latencyMs: input.latencyMs,
        message: "Authentication failed",
        success: false,
      };
    }

    if (statusCode === 403) {
      return {
        error: "API Key does not have required permissions",
        latencyMs: input.latencyMs,
        message: "Access denied",
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

export async function testAmplitudeConnection(
  credentials: AmplitudeCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));

  try {
    await fetchAmplitudeApi({
      credentials,
      endpoint: "/api/2/taxonomy/event",
      options: {
        method: "GET",
        timeoutMs,
      },
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
