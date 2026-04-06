import type { MessageInitShape } from "@bufbuild/protobuf";

import {
  CLI_DEFAULT_PAGE_LIMIT,
  parsePageCursor,
  parseSelectedFields,
} from "../../read-controls-policy";
import type {
  CliFieldsReadControls,
  CliPaginatedReadControls,
} from "../../read-controls-policy";
import { throwCliConnectError } from "../error";
import { CliPageSchema } from "../gen/onequery/cli/v1/common_pb";
import type { CliPaginatedQueryInput, CliReadControlsConfig } from "./types";

export function parseCliFieldsReadControls(
  input: { fields?: string },
  config: CliReadControlsConfig
): CliFieldsReadControls {
  const selectedFields = parseSelectedFields(
    input.fields,
    config.allowedFields
  );
  if (!selectedFields.ok) {
    throwCliReadControlsProblem({
      detail: selectedFields.message,
      field: "fields",
      hint: config.hint,
      stage: config.fieldStages?.fields ?? config.defaultStage,
    });
  }

  return {
    selectedFields: selectedFields.value,
  };
}

export function parseCliPaginatedReadControls(
  input: CliPaginatedQueryInput,
  config: CliReadControlsConfig
): CliPaginatedReadControls {
  const selectedFields = parseSelectedFields(
    input.fields,
    config.allowedFields
  );
  if (!selectedFields.ok) {
    throwCliReadControlsProblem({
      detail: selectedFields.message,
      field: "fields",
      hint: config.hint,
      stage: config.fieldStages?.fields ?? config.defaultStage,
    });
  }

  const offset = parsePageCursor(input.cursor);
  if (!offset.ok) {
    throwCliReadControlsProblem({
      detail: offset.message,
      field: "cursor",
      hint: config.hint,
      stage: config.fieldStages?.cursor ?? config.defaultStage,
    });
  }

  return {
    limit: input.limit ?? CLI_DEFAULT_PAGE_LIMIT,
    offset: offset.value,
    selectedFields: selectedFields.value,
  };
}

export function buildCliPage(page: {
  nextCursor: string | null;
  returned: number;
  hasMore: boolean;
}): MessageInitShape<typeof CliPageSchema> {
  return {
    hasMore: page.hasMore,
    returned: BigInt(page.returned),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

function throwCliReadControlsProblem(input: {
  field: string;
  detail: string;
  hint: string;
  stage: CliReadControlsConfig["defaultStage"];
}): never {
  throwCliConnectError({
    detail: input.detail,
    hint: input.hint,
    key: "INVALID_REQUEST",
    stage: input.stage,
  });
}
