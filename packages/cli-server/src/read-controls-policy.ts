import { base64UrlToUtf8 } from "@onequery/codecs/base64";

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

type ParseSuccess<T> = {
  ok: true;
  value: T;
};

type ParseFailure = {
  ok: false;
  message: string;
};

type ParseResult<T> = ParseSuccess<T> | ParseFailure;

type CursorPayload = {
  offset: number;
};

function parseFailure(message: string): ParseFailure {
  return {
    message,
    ok: false,
  };
}

function parseSuccess<T>(value: T): ParseSuccess<T> {
  return {
    ok: true,
    value,
  };
}

function decodeBase64Url(value: string): ParseResult<string> {
  try {
    return parseSuccess(base64UrlToUtf8.decode(value));
  } catch {
    return parseFailure("cursor is invalid");
  }
}

export function parsePageCursor(
  cursor: string | undefined
): ParseResult<number> {
  if (!cursor) {
    return parseSuccess(0);
  }

  const payloadText = decodeBase64Url(cursor);
  if (!payloadText.ok) {
    return payloadText;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText.value);
  } catch {
    return parseFailure("cursor is invalid");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("offset" in parsed) ||
    typeof parsed.offset !== "number" ||
    !Number.isInteger(parsed.offset) ||
    parsed.offset < 0
  ) {
    return parseFailure("cursor is invalid");
  }

  return parseSuccess(parsed.offset);
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
    return parseSuccess(null);
  }

  const allowed = new Set(allowedFields);
  const selected = new Set(
    rawFields
      .split(",")
      .map((field) => field.trim())
      .filter((field) => field.length > 0)
  );

  if (selected.size === 0) {
    return parseFailure("fields must contain at least one field path");
  }

  for (const field of selected) {
    if (!allowed.has(field)) {
      return parseFailure(`unsupported field selection "${field}"`);
    }
  }

  return parseSuccess(selected);
}
