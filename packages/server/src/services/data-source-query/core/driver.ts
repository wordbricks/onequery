import type { DatabaseCredentials } from "@onequery/db/server";

import type { DataSourceTestOutcome } from "./connection-test";
import type { QueryErrorClassifier } from "./errors";
import type { QueryDeadline } from "./timeout";
import type {
  DatabaseQueryExecution,
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

export type ProviderQueryDriver<
  C extends DatabaseCredentials = DatabaseCredentials,
> = {
  readonly provider: C["type"];
  readonly capabilities: ProviderQueryCapabilities;
  validateSql(input: { credentials: C; sql: string }): Promise<ValidatedSql>;
  execute(input: {
    credentials: C;
    sql: ValidatedSql;
    deadline: QueryDeadline;
    context: QueryExecutionContext;
    mode: QueryExecutionMode;
  }): Promise<DatabaseQueryExecution>;
  classifyError?: QueryErrorClassifier;
  testConnection(input: {
    credentials: C;
    deadline: QueryDeadline;
    context: QueryExecutionContext;
  }): Promise<DataSourceTestOutcome>;
};

export type ProviderRegistry = {
  [Provider in DatabaseCredentials["type"]]: ProviderQueryDriver<
    Extract<DatabaseCredentials, { type: Provider }>
  >;
};
