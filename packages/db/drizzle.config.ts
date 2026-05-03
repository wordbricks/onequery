import { defineConfig } from "drizzle-kit";

const pgliteDir = process.env.ONEQUERY_PGLITE_DIR;

if (!pgliteDir) {
  throw new Error(
    "ONEQUERY_PGLITE_DIR is required for local Drizzle commands."
  );
}

export default defineConfig({
  dbCredentials: {
    url: pgliteDir,
  },
  dialect: "postgresql",
  driver: "pglite",
  migrations: {
    prefix: "timestamp",
  },
  out: "./src/migrations",
  schema: [
    "./src/schema/audit-feed-entries.ts",
    "./src/schema/audit-projection-checkpoints.ts",
    "./src/schema/audit-workflow.ts",
    "./src/schema/auth.ts",
    "./src/schema/bigquery-query-costs.ts",
    "./src/schema/connectors.ts",
    "./src/schema/data-source-query-costs.ts",
    "./src/schema/data-sources.ts",
    "./src/schema/data-source-table-usage.ts",
    "./src/schema/organization-profiles.ts",
    "./src/schema/pending-workflow-effects.ts",
    "./src/schema/query-actions.ts",
    "./src/schema/user-profiles.ts",
    "./src/schema/source-api-actions.ts",
    "./src/schema/workflow-journal.ts",
    "./src/schema/relations.ts",
  ],
});
