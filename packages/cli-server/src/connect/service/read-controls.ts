import type { MessageInitShape } from "@bufbuild/protobuf";

import {
  CLI_DEFAULT_PAGE_LIMIT,
  parsePageCursor,
} from "../../read-controls-policy";
import { throwCliConnectError } from "../error";
import { CliPageSchema } from "../gen/onequery/cli/v1/common_pb";
import type { CliPaginatedQueryInput } from "./types";

export function parseCliPaginatedReadControls(input: CliPaginatedQueryInput) {
  const offset = parsePageCursor(input.cursor);
  if (!offset.ok) {
    throwCliReadControlsProblem(offset.message);
  }

  return {
    limit: input.limit ?? CLI_DEFAULT_PAGE_LIMIT,
    offset: offset.value,
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
    key: "READ_QUERY_INPUT_INVALID",
  });
}
