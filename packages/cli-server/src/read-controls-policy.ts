import { base64UrlToUtf8 } from "@onequery/codecs/base64";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

export const CLI_DEFAULT_PAGE_LIMIT = 50;

export type CliSelectedFields = ReadonlySet<string> | null;

export type CliFieldsReadControls = {
  selectedFields: CliSelectedFields;
};

export type CliPaginatedReadControls = CliFieldsReadControls & {
  limit: number;
  offset: number;
};

export type CliPage = {
  nextCursor: string | null;
  returned: number;
  hasMore: boolean;
};

class ReadControlsParseError extends TaggedError("ReadControlsParseError")<{
  message: string;
  cause?: unknown;
}>() {}

type ParseResult<T> = ResultType<T, ReadControlsParseError>;

type CursorPayload = {
  offset: number;
};

function parseFailure(message: string): ReadControlsParseError {
  return new ReadControlsParseError({ message });
}

function decodeBase64Url(value: string): ParseResult<string> {
  return Result.try({
    try: () => base64UrlToUtf8.decode(value),
    catch: (cause) =>
      new ReadControlsParseError({
        cause,
        message: "cursor is invalid",
      }),
  });
}

export function parsePageCursor(
  cursor: string | undefined
): ParseResult<number> {
  if (!cursor) {
    return Result.ok(0);
  }

  const payloadText = decodeBase64Url(cursor);
  if (payloadText.isErr()) {
    return Result.err(payloadText.error);
  }

  const parsed = Result.try({
    try: () => JSON.parse(payloadText.value),
    catch: (cause) =>
      new ReadControlsParseError({
        cause,
        message: "cursor is invalid",
      }),
  });
  if (parsed.isErr()) {
    return Result.err(parsed.error);
  }

  if (
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    !("offset" in parsed.value) ||
    typeof parsed.value.offset !== "number" ||
    !Number.isInteger(parsed.value.offset) ||
    parsed.value.offset < 0
  ) {
    return Result.err(parseFailure("cursor is invalid"));
  }

  return Result.ok(parsed.value.offset);
}

export function encodePageCursor(offset: number): string {
  const payload: CursorPayload = { offset };
  return base64UrlToUtf8.encode(JSON.stringify(payload));
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
      hasMore,
      nextCursor: hasMore ? encodePageCursor(nextOffset) : null,
      returned: pageItems.length,
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
