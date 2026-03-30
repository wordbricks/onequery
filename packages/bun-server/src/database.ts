import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { prepareSelfHostDatabase } from "@onequery/db/server";

function resolveMigrationsDir(
  rootDir: string,
  processEnv: NodeJS.ProcessEnv
): string {
  if (processEnv.ONEQUERY_DB_MIGRATIONS_DIR) {
    return resolve(rootDir, processEnv.ONEQUERY_DB_MIGRATIONS_DIR);
  }

  const packagedMigrationsDir = resolve(rootDir, "runtime", "migrations");
  if (existsSync(packagedMigrationsDir)) {
    return packagedMigrationsDir;
  }

  return resolve(rootDir, "packages", "db", "src", "migrations");
}

export async function prepareRuntimeDatabase(options: {
  databaseUrl: string;
  processEnv?: NodeJS.ProcessEnv;
  rootDir: string;
}) {
  const processEnv = options.processEnv ?? process.env;
  return prepareSelfHostDatabase({
    connectionString: options.databaseUrl,
    migrationsFolder: resolveMigrationsDir(options.rootDir, processEnv),
  });
}
