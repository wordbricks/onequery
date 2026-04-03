import { pgTable as drizzlePgTable } from "drizzle-orm/pg-core";
import type { PgTableFn } from "drizzle-orm/pg-core";

/**
 * pgTable wrapper with RLS enabled by default.
 *
 * Uses standard PostgreSQL Row Level Security (RLS), not Supabase-specific features.
 * This ensures database portability - works on any PostgreSQL database.
 *
 * When RLS is enabled without policies, PostgreSQL applies a default-deny policy,
 * meaning no rows are visible or can be modified by non-superusers.
 * Add policies separately based on your deployment requirements.
 */
export const pgTable: PgTableFn = ((
  name: string,
  columns: unknown,
  extraConfig?: unknown
) =>
  drizzlePgTable(
    name,
    columns as never,
    extraConfig as never
  ).enableRLS()) as unknown as PgTableFn;
