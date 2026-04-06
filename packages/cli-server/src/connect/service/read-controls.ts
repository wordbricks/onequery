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
    throwCliReadControlsProblem(selectedFields.message);
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
    throwCliReadControlsProblem(selectedFields.message);
  }

  const offset = parsePageCursor(input.cursor);
  if (!offset.ok) {
    throwCliReadControlsProblem(offset.message);
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

function throwCliReadControlsProblem(detail: string): never {
  throwCliConnectError({
    detail,
    key: "INVALID_REQUEST",
  });
}
