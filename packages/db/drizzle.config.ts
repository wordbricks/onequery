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
    "./src/schema/auth.ts",
    "./src/schema/bigquery-query-costs.ts",
    "./src/schema/cli-query-actions.ts",
    "./src/schema/cli-query-action-events.ts",
    "./src/schema/connectors.ts",
    "./src/schema/data-source-query-costs.ts",
    "./src/schema/data-sources.ts",
    "./src/schema/data-source-table-usage.ts",
    "./src/schema/organization-profiles.ts",
    "./src/schema/user-profiles.ts",
    "./src/schema/relations.ts",
  ],
});
