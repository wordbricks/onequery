import { durationFromMs } from "@bufbuild/protobuf/wkt";
import { ContentFormat } from "@onequery/proto-cli/cli/v1/common_pb";
import {
  SourceQuerySupport,
  SourceStatus,
  SourceTestUnsupportedReason,
} from "@onequery/proto-cli/cli/v1/source_pb";

import { getCliQueryableDatabaseProviderType } from "../../../source/model";
import { toCliSourceProvider } from "../source-provider";
import type {
  BuildCliSourceInput,
  CliSourceInit,
  GetSourceResponseInit,
  TestSourceResponseInit,
} from "./types";

export function toCliContentFormat(value: "markdown") {
  switch (value) {
    case "markdown":
      return ContentFormat.MARKDOWN;
  }
}

function toCliSourceStatus(value: BuildCliSourceInput["status"]) {
  switch (value) {
    case "active":
      return SourceStatus.ACTIVE;
    case "error":
      return SourceStatus.ERROR;
    case "disconnected":
      return SourceStatus.DISCONNECTED;
  }
}

export function buildCliSource(source: BuildCliSourceInput): CliSourceInit {
  const response: CliSourceInit = {
    sourceKey: source.sourceKey,
    provider: toCliSourceProvider(source.provider),
    querySupport:
      getCliQueryableDatabaseProviderType(source.provider, source.status) ===
      null
        ? SourceQuerySupport.NOT_SUPPORTED
        : SourceQuerySupport.SUPPORTED,
    status: toCliSourceStatus(source.status),
  };

  if (source.displayName) {
    response.displayName = source.displayName;
  }

  return response;
}

export function buildGetSourceResponse(
  source: BuildCliSourceInput
): GetSourceResponseInit {
  return {
    source: buildCliSource(source),
  };
}

function toCliSourceTestUnsupportedReason(value: "oauth" | "not_implemented") {
  switch (value) {
    case "oauth":
      return SourceTestUnsupportedReason.OAUTH;
    case "not_implemented":
      return SourceTestUnsupportedReason.NOT_IMPLEMENTED;
  }
}

export function buildTestSourceResponse(input: {
  source: BuildCliSourceInput;
  outcome:
    | {
        kind: "supported";
        success: boolean;
        message: string;
        latencyMs: number;
        error?: string;
      }
    | {
        kind: "unsupported";
        reason: "oauth" | "not_implemented";
        message: string;
      };
}): TestSourceResponseInit {
  const response: TestSourceResponseInit = {
    source: buildCliSource(input.source),
  };

  if (input.outcome.kind === "supported") {
    response.outcome = {
      case: "supported",
      value: {
        latency: durationFromMs(input.outcome.latencyMs),
        result: input.outcome.success
          ? {
              case: "passed",
              value: {
                message: input.outcome.message,
              },
            }
          : {
              case: "failed",
              value: {
                error: input.outcome.error ?? input.outcome.message,
                message: input.outcome.message,
              },
            },
      },
    };
    return response;
  }

  response.outcome = {
    case: "unsupported",
    value: {
      message: input.outcome.message,
      reason: toCliSourceTestUnsupportedReason(input.outcome.reason),
    },
  };
  return response;
}
