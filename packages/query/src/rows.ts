import { isRecord } from "@onequery/base";

export function normalizeRecordRows(
  source: string,
  rows: unknown
): Record<string, unknown>[] {
  if (!Array.isArray(rows)) {
    throw new TypeError(`${source} query did not return rows.`);
  }

  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`${source} row ${index + 1} is not an object.`);
    }

    return row;
  });
}

export function normalizeColumnRows(
  columns: { name: string; type: string }[],
  rows: string[][]
): Record<string, unknown>[] {
  const seenNames = new Set<string>();
  const normalizedNames = columns.map((column, index) => {
    const baseName =
      column.name.trim().length > 0 ? column.name : `column_${index + 1}`;
    if (!seenNames.has(baseName)) {
      seenNames.add(baseName);
      return baseName;
    }

    let duplicateIndex = 2;
    let candidate = `${baseName}_${duplicateIndex}`;
    while (seenNames.has(candidate)) {
      duplicateIndex += 1;
      candidate = `${baseName}_${duplicateIndex}`;
    }
    seenNames.add(candidate);
    return candidate;
  });

  return rows.map((row) => {
    const result: Record<string, unknown> = {};
    row.forEach((value, index) => {
      const key = normalizedNames[index] ?? `column_${index + 1}`;
      result[key] = value;
    });
    return result;
  });
}

export function parseIntegerString(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
