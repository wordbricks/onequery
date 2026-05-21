import type { DatabaseCredentials } from "@onequery/db/server";

import { toExecutionError } from "./errors";
import { getQueryDriver } from "./registry";
import { createQueryDeadline } from "./timeout";
import type {
  DatabaseQueryExecution,
  RawDatabaseQueryInput,
  ValidatedDatabaseQueryInput,
  ValidatedSql,
} from "./types";

export async function executeDatabaseQuery(
  input: RawDatabaseQueryInput
): Promise<Record<string, unknown>[]> {
  const result = await executeDatabaseQueryInternal(input, {
    includeStats: false,
    validate: true,
  });
  return result.rows;
}

export async function executeValidatedDatabaseQuery(
  input: ValidatedDatabaseQueryInput
): Promise<Record<string, unknown>[]> {
  const result = await executeDatabaseQueryInternal(input, {
    includeStats: false,
    validate: false,
  });
  return result.rows;
}

export async function executeDatabaseQueryWithStats(
  input: RawDatabaseQueryInput
): Promise<DatabaseQueryExecution> {
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
): Promise<DatabaseQueryExecution> {
  const driver = getQueryDriver(input.credentials.type);
  const deadline = createQueryDeadline(input.timeoutMs);

  try {
    const sql = options.validate
      ? await driver.validateSql({
          credentials: input.credentials as never,
          sql: (input as RawDatabaseQueryInput).sql,
        })
      : ((input as ValidatedDatabaseQueryInput).normalizedSql as ValidatedSql);

    return await driver.execute({
      context: {
        db: input.db,
        organizationId: input.organizationId,
      },
      credentials: input.credentials as never,
      deadline,
      mode: options.includeStats ? "rows_with_stats" : "rows",
      sql,
    });
  } catch (error) {
    throw toExecutionError(error, driver.classifyError);
  }
}

export function assertProviderCredentials<
  Provider extends DatabaseCredentials["type"],
>(
  credentials: DatabaseCredentials,
  provider: Provider
): Extract<DatabaseCredentials, { type: Provider }> {
  if (credentials.type !== provider) {
    throw new TypeError(
      `Expected ${provider} credentials but received ${credentials.type}.`
    );
  }
  return credentials as Extract<DatabaseCredentials, { type: Provider }>;
}
