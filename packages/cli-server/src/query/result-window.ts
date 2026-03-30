import { z } from "zod";

const CLI_DEFAULT_QUERY_MAX_ROWS = 100;
const CLI_MAX_QUERY_MAX_ROWS = 1000;
const CLI_DEFAULT_QUERY_MAX_BYTES = 1_048_576;
const CLI_MAX_QUERY_MAX_BYTES = 4_194_304;
const CLI_DEFAULT_QUERY_CELL_MAX_CHARS = 2000;
const CLI_MAX_QUERY_CELL_MAX_CHARS = 8000;
const CLI_DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const CLI_MAX_QUERY_TIMEOUT_MS = 120_000;

const CliQueryResultWindowSchema = z
  .object({
    cellMaxChars: z
      .number()
      .int()
      .min(1)
      .max(CLI_MAX_QUERY_CELL_MAX_CHARS)
      .optional(),
    maxBytes: z.number().int().min(1).max(CLI_MAX_QUERY_MAX_BYTES).optional(),
    maxRows: z.number().int().min(1).max(CLI_MAX_QUERY_MAX_ROWS).optional(),
    timeoutMs: z.number().int().min(1).max(CLI_MAX_QUERY_TIMEOUT_MS).optional(),
  })
  .meta({ id: "CliQueryResultWindow" });

type CliQueryResultWindow = z.infer<typeof CliQueryResultWindowSchema>;

const textEncoder = new TextEncoder();

export function resolveQueryResultWindow(
  input: CliQueryResultWindow
): Required<CliQueryResultWindow> {
  return {
    cellMaxChars: input.cellMaxChars ?? CLI_DEFAULT_QUERY_CELL_MAX_CHARS,
    maxBytes: input.maxBytes ?? CLI_DEFAULT_QUERY_MAX_BYTES,
    maxRows: input.maxRows ?? CLI_DEFAULT_QUERY_MAX_ROWS,
    timeoutMs: input.timeoutMs ?? CLI_DEFAULT_QUERY_TIMEOUT_MS,
  };
}

export function applyQueryResultWindow(input: {
  rows: readonly (readonly string[])[];
  maxRows: number;
  maxBytes: number;
  cellMaxChars: number;
}) {
  let truncated = false;
  let rows = input.rows;

  if (rows.length > input.maxRows) {
    rows = rows.slice(0, input.maxRows);
    truncated = true;
  }

  const clippedRows = rows.map((row) =>
    row.map((cell) => truncateCell(cell, input.cellMaxChars))
  );

  if (
    clippedRows.some((row, rowIndex) =>
      row.some((cell, columnIndex) => cell !== rows[rowIndex]?.[columnIndex])
    )
  ) {
    truncated = true;
  }

  const boundedRows: string[][] = [];
  let usedBytes = 0;
  for (const row of clippedRows) {
    const rowBytes = textEncoder.encode(JSON.stringify(row)).length;
    if (boundedRows.length > 0 && usedBytes + rowBytes > input.maxBytes) {
      truncated = true;
      break;
    }

    if (boundedRows.length === 0 && rowBytes > input.maxBytes) {
      truncated = true;
      break;
    }

    boundedRows.push(row);
    usedBytes += rowBytes;
  }

  return {
    rows: boundedRows,
    truncated,
  };
}

function truncateCell(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 3) {
    return ".".repeat(maxChars);
  }

  return `${value.slice(0, maxChars - 3)}...`;
}
