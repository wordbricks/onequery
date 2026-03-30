import type { MixpanelCredentials } from "@onequery/db/server";

import {
  DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE,
  fetchMixpanelQueryApi,
} from "../mixpanel/relay";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";
import type { ConnectionTestResult } from "./postgres-tester";

const MIXPANEL_ERROR_PATTERN = /^Mixpanel API error \((\d{3})\):\s*([\s\S]*)$/;
const MIXPANEL_TIMEOUT_PREFIX = "Mixpanel request timeout after ";

function toFailureResult(input: {
  error: unknown;
  latencyMs: number;
  timeoutSeconds: number;
}): ConnectionTestResult {
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error);

  if (errorMessage.startsWith(MIXPANEL_TIMEOUT_PREFIX)) {
    return {
      error: `Connection timed out after ${input.timeoutSeconds} seconds`,
      latencyMs: input.latencyMs,
      message: "Connection timed out",
      success: false,
    };
  }

  const matched = errorMessage.match(MIXPANEL_ERROR_PATTERN);
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
        error: "Invalid Service Account credentials",
        latencyMs: input.latencyMs,
        message: "Authentication failed",
        success: false,
      };
    }

    if (statusCode === 403) {
      return {
        error: "Service Account does not have access to this project",
        latencyMs: input.latencyMs,
        message: "Access denied",
        success: false,
      };
    }

    if (statusCode === 400) {
      const lowerError = detail.toLowerCase();
      if (
        lowerError.includes("invalid project") ||
        lowerError.includes("project not found")
      ) {
        return {
          error: "Project ID not found or not accessible",
          latencyMs: input.latencyMs,
          message: "Invalid Project ID",
          success: false,
        };
      }
      return {
        latencyMs: input.latencyMs,
        message: `Connection successful (${input.latencyMs}ms)`,
        success: true,
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

export async function testMixpanelConnection(
  credentials: MixpanelCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));

  try {
    await fetchMixpanelQueryApi({
      credentials,
      endpoint: "/query/engage",
      options: {
        body: {
          filter_by_cohort: {},
          page: 0,
          page_size: DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE,
        },
        bodyFormat: "form",
        method: "POST",
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
