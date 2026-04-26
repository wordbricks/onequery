import { sql } from "@onequery/db/server";

function escapeLikePattern(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export function buildCaseInsensitiveContains(column: unknown, value: string) {
  const pattern = `%${escapeLikePattern(value.toLowerCase())}%`;
  return sql`lower(coalesce(${column}, '')) like ${pattern} escape '\\'`;
}

export function buildCaseInsensitiveEquals(column: unknown, value: string) {
  return sql`lower(coalesce(${column}, '')) = ${value.toLowerCase()}`;
}
