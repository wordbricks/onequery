import { prepareApplicationDatabase } from "@onequery/db/server";
import type { DatabasePreparationResult } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

class RuntimeDatabasePreparationError extends TaggedError(
  "RuntimeDatabasePreparationError"
)<{
  cause: unknown;
  message: string;
  migrationsDir: string;
}>() {}

type PrepareRuntimeDatabaseError = RuntimeDatabasePreparationError;

type PrepareRuntimeDatabaseResult = ResultType<
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
