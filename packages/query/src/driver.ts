import type { DataSourceTestOutcome } from "./connection-test";
import type {
  DatabaseCredentialProviderType,
  DatabaseCredentials,
} from "./credentials";
import type { QueryErrorClassifier } from "./errors";
import type { QueryDeadline } from "./timeout";
import type {
  DatabaseQueryExecution,
  DatabaseQueryResult,
  PreparedReadOnlyQuery,
  QueryExecutionContext,
  QueryExecutionMode,
  ValidatedSql,
} from "./types";

export type ProviderQueryCapabilities = {
  stats: boolean;
  dryRun: boolean;
  connectionTest: boolean;
  cancellation: "none" | "best_effort" | "guaranteed";
};

export type SqlValidator = {
  validateReadOnlySql<Provider extends DatabaseCredentialProviderType>(input: {
    provider: Provider;
    sql: string;
  }): Promise<DatabaseQueryResult<PreparedReadOnlyQuery<Provider>>>;
};

export type ProviderQueryDriver<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
> = {
  readonly provider: Credentials["type"];
  readonly capabilities: ProviderQueryCapabilities;
  validateSql?(input: {
    credentials: Credentials;
    sql: string;
  }): Promise<DatabaseQueryResult<ValidatedSql>>;
  execute(input: {
    credentials: Credentials;
    sql: ValidatedSql;
    deadline: QueryDeadline;
    context: Context;
    mode: QueryExecutionMode;
  }): Promise<DatabaseQueryResult<DatabaseQueryExecution>>;
  classifyError?: QueryErrorClassifier;
  testConnection(input: {
    credentials: Credentials;
    deadline: QueryDeadline;
    context: Context;
  }): Promise<DataSourceTestOutcome>;
};

export type ProviderRegistry<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
> = {
  [Provider in Credentials["type"]]: ProviderQueryDriver<
    Extract<Credentials, { type: Provider }>,
    Context
  >;
};

export function getQueryDriver<
  Credentials extends DatabaseCredentials,
  Context extends QueryExecutionContext,
  Provider extends Credentials["type"],
>(
  registry: ProviderRegistry<Credentials, Context>,
  provider: Provider
): ProviderQueryDriver<Extract<Credentials, { type: Provider }>, Context> {
  return registry[provider];
}
