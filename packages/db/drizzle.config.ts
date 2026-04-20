import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  dialect: "postgresql",
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
    "./src/schema/query-actions.ts",
    "./src/schema/query-action-events.ts",
    "./src/schema/user-profiles.ts",
    "./src/schema/source-api-actions.ts",
    "./src/schema/source-api-action-events.ts",
    "./src/schema/workflow-commands.ts",
    "./src/schema/workflow-effect-dispatches.ts",
    "./src/schema/relations.ts",
  ],
});
