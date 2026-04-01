import { prepareSelfHostDatabase } from "@onequery/db/server";

export async function prepareRuntimeDatabase(options: {
  databaseUrl: string;
  migrationsDir: string;
}) {
  // Comment: launch.json is the single source of truth for runtime asset paths;
  // compiled Bun executables cannot reliably derive migrations from import.meta.url.
  return prepareSelfHostDatabase({
    connectionString: options.databaseUrl,
    migrationsFolder: options.migrationsDir,
  });
}
