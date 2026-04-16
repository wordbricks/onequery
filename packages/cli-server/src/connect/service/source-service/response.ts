import { getCliQueryableDatabaseProviderType } from "../../../source/model";
import { CliContentFormat } from "../../gen/onequery/cli/v1/common_pb";
import {
  CliSourceStatus,
  CliSourceTestUnsupportedReason,
} from "../../gen/onequery/cli/v1/source_pb";
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
      return CliContentFormat.MARKDOWN;
  }
}

function toCliSourceStatus(value: BuildCliSourceInput["status"]) {
  switch (value) {
    case "active":
      return CliSourceStatus.ACTIVE;
    case "error":
      return CliSourceStatus.ERROR;
    case "disconnected":
      return CliSourceStatus.DISCONNECTED;
  }
}

export function buildCliSource(source: BuildCliSourceInput): CliSourceInit {
  const response: CliSourceInit = {
    sourceKey: source.sourceKey,
    provider: toCliSourceProvider(source.provider),
    queryable:
      getCliQueryableDatabaseProviderType(source.provider, source.status) !==
      null,
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
      return CliSourceTestUnsupportedReason.OAUTH;
    case "not_implemented":
      return CliSourceTestUnsupportedReason.NOT_IMPLEMENTED;
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
        ...(input.outcome.error ? { error: input.outcome.error } : {}),
        latencyMs: BigInt(input.outcome.latencyMs),
        message: input.outcome.message,
        success: input.outcome.success,
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
