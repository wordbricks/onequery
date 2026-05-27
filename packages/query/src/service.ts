import { Result } from "better-result";

import type { DatabaseCredentials } from "./credentials";
import type { ProviderRegistry, SqlValidator } from "./driver";
import { getQueryDriver } from "./driver";
import { createQueryDeadline } from "./timeout";
import type { QueryDeadline } from "./timeout";
import type {
  DatabaseQueryExecution,
  DatabaseQueryResult,
  PreparedDatabaseQueryInput,
  PreparedReadOnlyQuery,
  QueryExecutionContext,
  RawDatabaseQueryInput,
  ValidatedDatabaseQueryInput,
  ValidatedSql,
} from "./types";

export type QueryService<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
> = {
  prepareReadOnlyQuery<Provider extends Credentials["type"]>(input: {
    provider: Provider;
    sql: string;
  }): Promise<DatabaseQueryResult<PreparedReadOnlyQuery<Provider>>>;
  executeDatabaseQuery(
    input: RawDatabaseQueryInput<Credentials, Context>
  ): Promise<DatabaseQueryResult<Record<string, unknown>[]>>;
  executeDatabaseQueryWithStats(
    input: RawDatabaseQueryInput<Credentials, Context>
  ): Promise<DatabaseQueryResult<DatabaseQueryExecution>>;
  executePreparedDatabaseQuery(
    input: PreparedDatabaseQueryInput<Credentials, Context>
  ): Promise<DatabaseQueryResult<Record<string, unknown>[]>>;
  executeValidatedDatabaseQuery(
    input: ValidatedDatabaseQueryInput<Credentials, Context>
  ): Promise<DatabaseQueryResult<Record<string, unknown>[]>>;
  executeValidatedDatabaseQueryWithStats(
    input: ValidatedDatabaseQueryInput<Credentials, Context>
  ): Promise<DatabaseQueryResult<DatabaseQueryExecution>>;
};

export function createQueryService<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
>(input: {
  createDeadline?: (timeoutMs: number | null | undefined) => QueryDeadline;
  registry: ProviderRegistry<Credentials, Context>;
  validator: SqlValidator;
}): QueryService<Credentials, Context> {
  const createDeadline = input.createDeadline ?? createQueryDeadline;

  return {
    prepareReadOnlyQuery: (queryInput) =>
      input.validator.validateReadOnlySql(queryInput),
    executeDatabaseQuery: async (queryInput) => {
      const execution = await executeDatabaseQueryInternal(
        queryInput,
        {
          includeStats: false,
          validate: true,
        },
        input.registry,
        input.validator,
        createDeadline
      );
      return execution.map((result) => result.rows);
    },
    executeDatabaseQueryWithStats: (queryInput) =>
      executeDatabaseQueryInternal(
        queryInput,
        {
          includeStats: true,
          validate: true,
        },
        input.registry,
        input.validator,
        createDeadline
      ),
    executePreparedDatabaseQuery: async (queryInput) => {
      const execution = await executeDatabaseQueryInternal(
        queryInput,
        {
          includeStats: false,
          validate: false,
        },
        input.registry,
        input.validator,
        createDeadline
      );
      return execution.map((result) => result.rows);
    },
    executeValidatedDatabaseQuery: async (queryInput) => {
      const execution = await executeDatabaseQueryInternal(
        queryInput,
        {
          includeStats: false,
          validate: false,
        },
        input.registry,
        input.validator,
        createDeadline
      );
      return execution.map((result) => result.rows);
    },
    executeValidatedDatabaseQueryWithStats: (queryInput) =>
      executeDatabaseQueryInternal(
        queryInput,
        {
          includeStats: true,
          validate: false,
        },
        input.registry,
        input.validator,
        createDeadline
      ),
  };
}

async function executeDatabaseQueryInternal<
  Credentials extends DatabaseCredentials,
  Context extends QueryExecutionContext,
>(
  queryInput:
    | RawDatabaseQueryInput<Credentials, Context>
    | PreparedDatabaseQueryInput<Credentials, Context>
    | ValidatedDatabaseQueryInput<Credentials, Context>,
  options: {
    includeStats: boolean;
    validate: boolean;
  },
  registry: ProviderRegistry<Credentials, Context>,
  validator: SqlValidator,
  createDeadline: (timeoutMs: number | null | undefined) => QueryDeadline
): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  const driver = getQueryDriver(registry, queryInput.credentials.type);
  const deadline = createDeadline(queryInput.timeoutMs);
  const context = queryInput.context ?? ({} as Context);

  return Result.gen(async function* executeDatabaseQueryFlow() {
    const sql = yield* Result.await(
      resolveExecutableSql(queryInput, options, validator)
    );
    const execution = yield* Result.await(
      driver.execute({
        context,
        credentials: queryInput.credentials as never,
        deadline,
        mode: options.includeStats ? "rows_with_stats" : "rows",
        sql,
      })
    );
    return Result.ok(execution);
  });
}

async function resolveExecutableSql<
  Credentials extends DatabaseCredentials,
  Context extends QueryExecutionContext,
>(
  queryInput:
    | RawDatabaseQueryInput<Credentials, Context>
    | PreparedDatabaseQueryInput<Credentials, Context>
    | ValidatedDatabaseQueryInput<Credentials, Context>,
  options: {
    validate: boolean;
  },
  validator: SqlValidator
): Promise<DatabaseQueryResult<ValidatedSql>> {
  if (options.validate && "sql" in queryInput) {
    const prepared = await validator.validateReadOnlySql({
      provider: queryInput.credentials.type,
      sql: queryInput.sql,
    });
    return prepared.map((query) => query.sql);
  }

  if ("query" in queryInput) {
    return Result.ok(queryInput.query.sql);
  }

  if ("normalizedSql" in queryInput) {
    return Result.ok(queryInput.normalizedSql as ValidatedSql);
  }

  return Result.ok(queryInput.sql as ValidatedSql);
}
