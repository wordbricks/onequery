import { prepareApplicationDatabase } from "@onequery/db/server";
import type { DatabasePreparationResult } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

export class RuntimeDatabasePreparationError extends TaggedError(
  "RuntimeDatabasePreparationError"
)<{
  cause: unknown;
  message: string;
  migrationsDir: string;
}>() {}

export type PrepareRuntimeDatabaseError = RuntimeDatabasePreparationError;

export type PrepareRuntimeDatabaseResult = ResultType<
  DatabasePreparationResult,
  PrepareRuntimeDatabaseError
>;

export async function prepareRuntimeDatabaseResult(options: {
  databaseUrl: string;
  migrationsDir: string;
}): Promise<PrepareRuntimeDatabaseResult> {
  return Result.tryPromise({
    try: async () =>
      prepareApplicationDatabase({
        connectionString: options.databaseUrl,
        migrationsFolder: options.migrationsDir,
      }),
    catch: (cause) =>
      new RuntimeDatabasePreparationError({
        cause,
        message: `Failed to prepare runtime database using migrations from ${options.migrationsDir}`,
        migrationsDir: options.migrationsDir,
      }),
  });
}

export async function prepareRuntimeDatabase(options: {
  databaseUrl: string;
  migrationsDir: string;
}) {
  // Comment: launch.json is the single source of truth for runtime asset paths;
  // the packaged server bundle cannot reliably derive migrations from
  // import.meta.url.
  const databasePreparationResult = await prepareRuntimeDatabaseResult(options);

  if (databasePreparationResult.isErr()) {
    throw databasePreparationResult.error;
  }

  return databasePreparationResult.value;
}
