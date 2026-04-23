import { z } from "zod";

const CLI_DEFAULT_QUERY_MAX_ROWS = 100;
const CLI_MAX_QUERY_MAX_ROWS = 1000;
const CLI_DEFAULT_QUERY_MAX_BYTES = 1_048_576;
const CLI_MAX_QUERY_MAX_BYTES = 4_194_304;
const CLI_DEFAULT_QUERY_CELL_MAX_CHARS = 2000;
const CLI_MAX_QUERY_CELL_MAX_CHARS = 8000;
const CLI_DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const CLI_MAX_QUERY_TIMEOUT_MS = 120_000;
const ELLIPSIS = "...";
const ELLIPSIS_CHAR_COUNT = 3;
const EMPTY_JSON_STRING_BYTE_LENGTH = 2;
const EMPTY_JSON_ARRAY_BYTE_LENGTH = 2;

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
const displayUnitSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

type CellPlan = {
  fullValue: string;
  prefixJsonInnerByteLengths: readonly number[];
  stateIndex: number;
  states: readonly CellState[];
  units: readonly string[];
};

type CellState =
  | {
      bytes: number;
      displayChars: number;
      kind: "dots" | "empty" | "full";
      retainedChars: number;
    }
  | {
      bytes: number;
      displayChars: number;
      kind: "truncated";
      retainedChars: number;
    };

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
  if (input.maxBytes < EMPTY_JSON_ARRAY_BYTE_LENGTH) {
    // Comment: any JSON array payload costs at least `[]`, so the best available
    // fallback under an impossible byte budget is an empty preview.
    return {
      rows: boundedRows,
      truncated: truncated || clippedRows.length > 0,
    };
  }

  let usedBytes = EMPTY_JSON_ARRAY_BYTE_LENGTH;
  for (const row of clippedRows) {
    const rowSeparatorBytes = boundedRows.length > 0 ? 1 : 0;
    const remainingBytes = input.maxBytes - usedBytes - rowSeparatorBytes;
    const fittedRow = fitRowWithinBytes(row, remainingBytes);
    if (fittedRow === null) {
      truncated = true;
      break;
    }

    if (!rowsEqual(fittedRow, row)) {
      truncated = true;
    }

    boundedRows.push(fittedRow);
    usedBytes += rowSeparatorBytes + rowByteLength(fittedRow);
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

  const cellPlans = row.map(buildCellPlan);
  let rowBytes = rowByteLengthFromPlans(cellPlans);
  if (rowBytes <= maxBytes) {
    return [...row];
  }

  // Comment: query results should stay rectangular so text and JSON consumers
  // can trust rows to align with the declared columns. When bytes are tight, we
  // compact cells in place, preferring to spend the byte budget on leftmost
  // columns first because they usually carry row identity and high-signal
  // summary values for both humans and machine consumers.
  if (minimalRowByteLength(cellPlans.length) > maxBytes) {
    return null;
  }

  for (
    let cellIndex = cellPlans.length - 1;
    cellIndex >= 0 && rowBytes > maxBytes;
    cellIndex -= 1
  ) {
    const cellPlan = cellPlans[cellIndex];
    if (cellPlan === undefined) {
      continue;
    }

    while (rowBytes > maxBytes) {
      const shrink = buildNextShrink(cellPlan);
      if (shrink === null) {
        break;
      }

      cellPlan.stateIndex = shrink.nextStateIndex;
      rowBytes -= shrink.bytesSaved;
    }
  }

  if (rowBytes > maxBytes) {
    return null;
  }

  return cellPlans.map(materializeCell);
}

function rowByteLength(row: readonly string[]): number {
  return (
    EMPTY_JSON_ARRAY_BYTE_LENGTH +
    Math.max(0, row.length - 1) +
    row.reduce((totalBytes, cell) => totalBytes + jsonStringByteLength(cell), 0)
  );
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

  const units = splitDisplayUnits(value);
  if (units.length <= maxChars) {
    return value;
  }

  return materializeTruncatedValue(value, units, maxChars);
}

function buildCellPlan(value: string): CellPlan {
  const units = splitDisplayUnits(value);
  const prefixJsonInnerByteLengths = [0];

  for (const unit of units) {
    prefixJsonInnerByteLengths.push(
      (prefixJsonInnerByteLengths.at(-1) ?? 0) + jsonStringInnerByteLength(unit)
    );
  }

  return {
    fullValue: value,
    prefixJsonInnerByteLengths,
    stateIndex: 0,
    states: buildCellStates(value, units, prefixJsonInnerByteLengths),
    units,
  };
}

function rowByteLengthFromPlans(cellPlans: readonly CellPlan[]): number {
  return (
    EMPTY_JSON_ARRAY_BYTE_LENGTH +
    Math.max(0, cellPlans.length - 1) +
    cellPlans.reduce(
      (totalBytes, cellPlan) =>
        totalBytes +
        (currentCellState(cellPlan)?.bytes ?? EMPTY_JSON_STRING_BYTE_LENGTH),
      0
    )
  );
}

function minimalRowByteLength(cellCount: number): number {
  return (
    EMPTY_JSON_ARRAY_BYTE_LENGTH +
    Math.max(0, cellCount - 1) +
    cellCount * EMPTY_JSON_STRING_BYTE_LENGTH
  );
}

function buildNextShrink(
  cellPlan: CellPlan
): { bytesSaved: number; nextStateIndex: number } | null {
  const currentState = currentCellState(cellPlan);
  const nextState = cellPlan.states[cellPlan.stateIndex + 1];
  if (currentState === undefined || nextState === undefined) {
    return null;
  }

  return {
    bytesSaved: currentState.bytes - nextState.bytes,
    nextStateIndex: cellPlan.stateIndex + 1,
  };
}

function materializeCell(cellPlan: CellPlan): string {
  const currentState = currentCellState(cellPlan);
  if (currentState === undefined) {
    return "";
  }

  switch (currentState.kind) {
    case "empty": {
      return "";
    }
    case "dots": {
      return ".".repeat(currentState.displayChars);
    }
    case "full": {
      return cellPlan.fullValue;
    }
    case "truncated": {
      return `${cellPlan.units.slice(0, currentState.retainedChars).join("")}${ELLIPSIS}`;
    }
  }
}

function materializeTruncatedValue(
  value: string,
  units: readonly string[],
  maxChars: number
): string {
  if (maxChars <= 0) {
    return "";
  }

  if (units.length <= maxChars) {
    return value;
  }

  if (maxChars <= ELLIPSIS_CHAR_COUNT) {
    return ".".repeat(maxChars);
  }

  return `${units.slice(0, maxChars - ELLIPSIS_CHAR_COUNT).join("")}${ELLIPSIS}`;
}

function splitDisplayUnits(value: string): string[] {
  if (displayUnitSegmenter === null) {
    return Array.from(value);
  }

  return Array.from(
    displayUnitSegmenter.segment(value),
    ({ segment }) => segment
  );
}

function jsonStringByteLength(value: string): number {
  return EMPTY_JSON_STRING_BYTE_LENGTH + jsonStringInnerByteLength(value);
}

function jsonStringInnerByteLength(value: string): number {
  return (
    textEncoder.encode(JSON.stringify(value)).length -
    EMPTY_JSON_STRING_BYTE_LENGTH
  );
}

function buildCellStates(
  value: string,
  units: readonly string[],
  prefixJsonInnerByteLengths: readonly number[]
): CellState[] {
  const candidateStates: CellState[] = [
    {
      bytes: jsonStringByteLength(value),
      displayChars: units.length,
      kind: "full",
      retainedChars: units.length,
    },
  ];

  for (
    let retainedChars = Math.max(units.length - ELLIPSIS_CHAR_COUNT, 0);
    retainedChars >= 1;
    retainedChars -= 1
  ) {
    candidateStates.push({
      bytes:
        EMPTY_JSON_STRING_BYTE_LENGTH +
        (prefixJsonInnerByteLengths[retainedChars] ?? 0) +
        ELLIPSIS.length,
      displayChars: retainedChars + ELLIPSIS_CHAR_COUNT,
      kind: "truncated",
      retainedChars,
    });
  }

  for (
    let dotCount = Math.min(ELLIPSIS_CHAR_COUNT, units.length);
    dotCount >= 1;
    dotCount -= 1
  ) {
    candidateStates.push({
      bytes: EMPTY_JSON_STRING_BYTE_LENGTH + dotCount,
      displayChars: dotCount,
      kind: "dots",
      retainedChars: 0,
    });
  }

  candidateStates.push({
    bytes: EMPTY_JSON_STRING_BYTE_LENGTH,
    displayChars: 0,
    kind: "empty",
    retainedChars: 0,
  });

  const states: CellState[] = [];
  for (const candidateState of candidateStates) {
    const previousState = states.at(-1);
    if (
      previousState === undefined ||
      candidateState.bytes < previousState.bytes
    ) {
      states.push(candidateState);
    }
  }

  return states;
}

function currentCellState(cellPlan: CellPlan): CellState | undefined {
  return cellPlan.states[cellPlan.stateIndex];
}
