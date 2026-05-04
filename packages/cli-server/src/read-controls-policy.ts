import { base64UrlJsonCodec } from "@onequery/codecs/json";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { z } from "zod";

export const CLI_DEFAULT_PAGE_LIMIT = 50;

type CliSelectedFields = ReadonlySet<string> | null;

type CliFieldsReadControls = {
  selectedFields: CliSelectedFields;
};

type CliPaginatedReadControls = CliFieldsReadControls & {
  limit: number;
  offset: number;
};

type CliPage = {
  nextCursor: string | null;
  returnedCount: number;
};

class ReadControlsParseError extends TaggedError("ReadControlsParseError")<{
  message: string;
  cause?: unknown;
}>() {}

type ParseResult<T> = ResultType<T, ReadControlsParseError>;

type CursorPayload = {
  offset: number;
};

const CursorPayloadSchema = z
  .object({
    offset: z.number().int().min(0),
  })
  .strict();

const CursorPayloadCodec = base64UrlJsonCodec(CursorPayloadSchema);

function parseFailure(
  message: string,
  cause?: unknown
): ReadControlsParseError {
  return new ReadControlsParseError({
    ...(cause === undefined ? {} : { cause }),
    message,
  });
}

export function parsePageCursor(
  cursor: string | undefined
): ParseResult<number> {
  if (!cursor) {
    return Result.ok(0);
  }

  const parsed = CursorPayloadCodec.safeDecode(cursor);
  if (!parsed.success) {
    return Result.err(parseFailure("cursor is invalid", parsed.error));
  }

  return Result.ok(parsed.data.offset);
}

export function encodePageCursor(offset: number): string {
  return CursorPayloadCodec.encode({ offset } satisfies CursorPayload);
}

export function paginateItems<T>(
  items: readonly T[],
  input: Pick<CliPaginatedReadControls, "limit" | "offset">
) {
  const pageItems = items.slice(input.offset, input.offset + input.limit);
  const nextOffset = input.offset + pageItems.length;
  const hasMore = nextOffset < items.length;

  return {
    items: pageItems,
    page: {
      nextCursor: hasMore ? encodePageCursor(nextOffset) : null,
      returnedCount: pageItems.length,
    } satisfies CliPage,
  };
}

export function parseSelectedFields(
  rawFields: string | undefined,
  allowedFields: readonly string[]
): ParseResult<CliSelectedFields> {
  if (!rawFields) {
    return Result.ok(null);
  }

  const allowed = new Set(allowedFields);
  const selected = new Set(
    rawFields
      .split(",")
      .map((field) => field.trim())
      .filter((field) => field.length > 0)
  );

  if (selected.size === 0) {
    return Result.err(
      parseFailure("fields must contain at least one field path")
    );
  }

  for (const field of selected) {
    if (!allowed.has(field)) {
      return Result.err(parseFailure(`unsupported field selection "${field}"`));
    }
  }

  return Result.ok(selected);
}
