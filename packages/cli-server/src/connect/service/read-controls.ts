import type { MessageInitShape } from "@bufbuild/protobuf";
import { Result } from "better-result";

import {
  CLI_DEFAULT_PAGE_LIMIT,
  parsePageCursor,
} from "../../read-controls-policy";
import { CliPageSchema } from "../gen/onequery/cli/v1/common_pb";
import { cliServiceErr } from "./result";
import type { CliPaginatedQueryInput } from "./types";

export function parseCliPaginatedReadControls(input: CliPaginatedQueryInput) {
  const offset = parsePageCursor(input.cursor);
  if (offset.isErr()) {
    return cliServiceErr({
      detail: offset.error.message,
      key: "READ_QUERY_INPUT_INVALID",
    });
  }

  return Result.ok({
    limit: input.limit ?? CLI_DEFAULT_PAGE_LIMIT,
    offset: offset.value,
  });
}

export function buildCliPage(page: {
  nextCursor: string | null;
  returnedCount: number;
}): MessageInitShape<typeof CliPageSchema> {
  return {
    returnedCount: BigInt(page.returnedCount),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}
