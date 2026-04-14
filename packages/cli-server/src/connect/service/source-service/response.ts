import { getCliQueryableDatabaseProviderType } from "../../../source/model";
import { CliContentFormat } from "../../gen/onequery/cli/v1/common_pb";
import { CliSourceStatus } from "../../gen/onequery/cli/v1/source_pb";
import { toCliSourceProvider } from "../source-provider";
import type {
  BuildGetSourceResponseInput,
  GetSourceResponseInit,
} from "./types";

export function toCliContentFormat(value: "markdown") {
  switch (value) {
    case "markdown":
      return CliContentFormat.MARKDOWN;
  }
}

function toCliSourceStatus(value: BuildGetSourceResponseInput["status"]) {
  switch (value) {
    case "active":
      return CliSourceStatus.ACTIVE;
    case "error":
      return CliSourceStatus.ERROR;
    case "disconnected":
      return CliSourceStatus.DISCONNECTED;
  }
}

export function buildGetSourceResponse(
  source: BuildGetSourceResponseInput
): GetSourceResponseInit {
  const response: GetSourceResponseInit = {
    name: source.sourceKey,
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
