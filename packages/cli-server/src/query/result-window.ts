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
    const remainingBytes = input.maxBytes - usedBytes;
    const fittedRow = fitRowWithinBytes(row, remainingBytes);
    if (fittedRow === null) {
      truncated = true;
      break;
    }

    if (!rowsEqual(fittedRow, row)) {
      truncated = true;
    }

    boundedRows.push(fittedRow);
    usedBytes += rowByteLength(fittedRow);
  }

  return {
    rows: boundedRows,
    truncated,
  };
}

function fitRowWithinBytes(
  row: readonly string[],
  maxBytes: number
): string[] | null {
  if (maxBytes <= 0) {
    return null;
  }

  if (rowByteLength(row) <= maxBytes) {
    return [...row];
  }

  const longestCellLength = row.reduce(
    (maxLength, cell) => Math.max(maxLength, cell.length),
    0
  );

  let low = 0;
  let high = longestCellLength;
  let bestFit: string[] | null = null;

  // Comment: query results should stay rectangular so text and JSON consumers
  // can trust rows to align with the declared columns. When bytes are tight, we
  // compact cells in place instead of dropping columns or emitting ragged rows.
  while (low <= high) {
    const maxChars = Math.floor((low + high) / 2);
    const candidate = row.map((cell) => truncateCell(cell, maxChars));

    if (rowByteLength(candidate) <= maxBytes) {
      bestFit = candidate;
      low = maxChars + 1;
    } else {
      high = maxChars - 1;
    }
  }

  if (bestFit !== null) {
    return bestFit;
  }

  return null;
}

function rowByteLength(row: readonly string[]): number {
  return textEncoder.encode(JSON.stringify(row)).length;
}

function rowsEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((cell, index) => cell === right[index])
  );
}

function truncateCell(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 0) {
    return "";
  }

  if (maxChars <= 3) {
    return ".".repeat(maxChars);
  }

  return `${value.slice(0, maxChars - 3)}...`;
}
