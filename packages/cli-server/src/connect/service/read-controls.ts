import { isFieldSet } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  CliPageRequestSchema,
  CliPageSchema,
} from "@onequery/proto-cli/cli/v1/common_pb";
import type { CliPageRequest } from "@onequery/proto-cli/cli/v1/common_pb";
import { Result } from "better-result";

import type { CliProblemKey } from "../../domain/problems";
import {
  CLI_DEFAULT_PAGE_LIMIT,
  parsePageCursor,
} from "../../read-controls-policy";
import { cliServiceErr } from "./result";

export function parseCliPageRequest(input: {
  page: CliPageRequest | undefined;
  invalidRequestKey: CliProblemKey;
}) {
  const cursor =
    input.page && isFieldSet(input.page, CliPageRequestSchema.field.cursor)
      ? input.page.cursor
      : undefined;
  const limit =
    input.page && isFieldSet(input.page, CliPageRequestSchema.field.limit)
      ? input.page.limit
      : undefined;
  const offset = parsePageCursor(cursor);
  if (offset.isErr()) {
    return cliServiceErr({
      detail: offset.error.message,
      key: input.invalidRequestKey,
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
