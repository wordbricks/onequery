import { isRecord } from "@onequery/base";

import type {
  BigQueryRow,
  BigQuerySchemaField,
  BigQueryTableSchema,
} from "./types";

export function mergeSchemaWithRows(
  schema: BigQueryTableSchema | undefined,
  rows: BigQueryRow[] | undefined
): Record<string, unknown>[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  return rows.map((row) => mergeRow(fields, row));
}

function mergeRow(
  fields: BigQuerySchemaField[],
  row: BigQueryRow
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const values = Array.isArray(row.f) ? row.f : [];
  const columnCount = Math.max(fields.length, values.length);
  const seenNames = new Set<string>();

  for (let index = 0; index < columnCount; index += 1) {
    const field = fields[index];
    const fieldName = resolveBigQueryFieldName(field?.name, index, seenNames);
    const rawValue = values[index]?.v;
    result[fieldName] = field
      ? convertFieldValue(field, rawValue)
      : rawValue === undefined
        ? null
        : unwrapBigQueryCell(rawValue);
  }

  return result;
}

function resolveBigQueryFieldName(
  name: string | undefined,
  index: number,
  seenNames: Set<string>
): string {
  const trimmedName = name?.trim();
  const baseName =
    trimmedName && trimmedName.length > 0 ? trimmedName : `column_${index + 1}`;

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
}

function convertFieldValue(
  field: BigQuerySchemaField,
  value: unknown
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (field.mode === "REPEATED") {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((entry) => {
      const entryValue = unwrapBigQueryCell(entry);
      return convertScalarFieldValue(
        {
          ...field,
          mode: undefined,
        },
        entryValue
      );
    });
  }

  return convertScalarFieldValue(field, value);
}

function convertScalarFieldValue(
  field: BigQuerySchemaField,
  value: unknown
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (field.type) {
    case "BOOL":
    case "BOOLEAN": {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        return value.toLowerCase() === "true";
      }
      return value;
    }
    case "FLOAT":
    case "FLOAT64": {
      if (typeof value === "number") {
        return value;
      }
      if (typeof value === "string" && value.length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
      }
      return value;
    }
    case "INT64":
    case "INTEGER": {
      if (typeof value === "number" && Number.isSafeInteger(value)) {
        return value;
      }
      if (typeof value === "string" && /^-?\d+$/u.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : value;
      }
      return value;
    }
    case "RECORD": {
      return convertRecordValue(field.fields, value);
    }
    default: {
      // Comment: BigQuery's REST API returns several scalar types as strings
      // (for example NUMERIC, TIMESTAMP, and BYTES). Keep them JSON-safe
      // instead of recreating @google-cloud/bigquery wrapper objects.
      return value;
    }
  }
}

function convertRecordValue(
  fields: BigQuerySchemaField[] | undefined,
  value: unknown
): unknown {
  const recordValue = unwrapBigQueryCell(value);
  if (!isRecord(recordValue)) {
    return recordValue;
  }

  const nestedFields = Array.isArray(fields) ? fields : [];
  const nestedRowFields = Array.isArray(recordValue.f) ? recordValue.f : [];
  return mergeRow(nestedFields, { f: nestedRowFields });
}

function unwrapBigQueryCell(value: unknown): unknown {
  if (isRecord(value) && "v" in value) {
    return value.v;
  }

  return value;
}
