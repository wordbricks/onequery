import { Result } from "better-result";

import { getQueryDriver } from "./registry";
import { createQueryDeadline } from "./timeout";
import type {
  DatabaseQueryExecution,
  DatabaseQueryResult,
  RawDatabaseQueryInput,
  ValidatedDatabaseQueryInput,
  ValidatedSql,
} from "./types";

export async function executeDatabaseQuery(
  input: RawDatabaseQueryInput
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  const result = await executeDatabaseQueryInternal(input, {
    includeStats: false,
    validate: true,
  });
  return result.map((execution) => execution.rows);
}

export async function executeValidatedDatabaseQuery(
  input: ValidatedDatabaseQueryInput
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  const result = await executeDatabaseQueryInternal(input, {
    includeStats: false,
    validate: false,
  });
  return result.map((execution) => execution.rows);
}

export async function executeDatabaseQueryWithStats(
  input: RawDatabaseQueryInput
): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  return executeDatabaseQueryInternal(input, {
    includeStats: true,
    validate: true,
  });
}

async function executeDatabaseQueryInternal(
  input: RawDatabaseQueryInput | ValidatedDatabaseQueryInput,
  options: {
    includeStats: boolean;
    validate: boolean;
  }
): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  const driver = getQueryDriver(input.credentials.type);
  const deadline = createQueryDeadline(input.timeoutMs);

  return Result.gen(async function* executeDatabaseQueryFlow() {
    const sql = options.validate
      ? yield* Result.await(
          driver.validateSql({
            credentials: input.credentials as never,
            sql: (input as RawDatabaseQueryInput).sql,
          })
        )
      : ((input as ValidatedDatabaseQueryInput).normalizedSql as ValidatedSql);

    const execution = yield* Result.await(
      driver.execute({
        context: {
          db: input.db,
          organizationId: input.organizationId,
        },
        credentials: input.credentials as never,
        deadline,
        mode: options.includeStats ? "rows_with_stats" : "rows",
        sql,
      })
    );
    return Result.ok(execution);
  });
}
