import { pgTable as basePgTable } from "drizzle-orm/pg-core";

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
export const pgTable: typeof basePgTable = ((
  ...args: Parameters<typeof basePgTable>
) => basePgTable(...args).enableRLS()) as typeof basePgTable;
