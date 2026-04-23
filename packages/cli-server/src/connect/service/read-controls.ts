import { isFieldSet } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Result } from "better-result";

import {
  CLI_DEFAULT_PAGE_LIMIT,
  parsePageCursor,
} from "../../read-controls-policy";
import {
  CliPageRequestSchema,
  CliPageSchema,
} from "../gen/onequery/cli/v1/common_pb";
import type { CliPageRequest } from "../gen/onequery/cli/v1/common_pb";
import { cliServiceErr } from "./result";

export function parseCliPageRequest(page: CliPageRequest | undefined) {
  const cursor =
    page && isFieldSet(page, CliPageRequestSchema.field.cursor)
      ? page.cursor
      : undefined;
  const limit =
    page && isFieldSet(page, CliPageRequestSchema.field.limit)
      ? page.limit
      : undefined;
  const offset = parsePageCursor(cursor);
  if (offset.isErr()) {
    return cliServiceErr({
      detail: offset.error.message,
      key: "READ_QUERY_INPUT_INVALID",
    });
  }

  return Result.ok({
    limit: limit ?? CLI_DEFAULT_PAGE_LIMIT,
    offset: offset.value,
  });
}

export function buildCliPage(page: {
  nextCursor: string | null;
  returnedCount: number;
}): MessageInitShape<typeof CliPageSchema> {
  return {
    returnedCount: page.returnedCount,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}
