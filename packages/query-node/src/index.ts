import { createQueryService } from "@onequery/query";
import type {
  ConnectorCredentials,
  DatabaseCredentials,
  MotherDuckCredentials,
  MySQLCredentials,
  PostgresCredentials,
  ProviderRegistry,
  SnowflakeCredentials,
} from "@onequery/query";
import type { WorkersQueryCredentials } from "@onequery/query-workers";
import { queryWorkersDriverRegistry } from "@onequery/query-workers";
import { createPolyglotSqlValidator } from "@onequery/sql-polyglot";

import { createAthenaConnectorQueryDriver } from "./providers/athena-connector/driver";
import type { AthenaConnectorQueryDriverDependencies } from "./providers/athena-connector/driver";
import { motherDuckQueryDriver } from "./providers/motherduck/driver";
import { mysqlQueryDriver } from "./providers/mysql/driver";
import { postgresQueryDriver } from "./providers/postgres/driver";
import { snowflakeQueryDriver } from "./providers/snowflake/driver";

export type NodeBaseQueryCredentials =
  | WorkersQueryCredentials
  | PostgresCredentials
  | MySQLCredentials
  | MotherDuckCredentials
  | SnowflakeCredentials;

export type NodeQueryCredentials =
  | NodeBaseQueryCredentials
  | ConnectorCredentials;

export type NodeBaseProviderRegistry =
  ProviderRegistry<NodeBaseQueryCredentials>;

export type NodeProviderRegistry = ProviderRegistry<NodeQueryCredentials>;

export type QueryNodeRuntime<
  Credentials extends DatabaseCredentials = NodeBaseQueryCredentials,
> = {
  registry: ProviderRegistry<Credentials>;
  service: ReturnType<typeof createQueryService<Credentials>>;
};

export const queryNodeDriverRegistry = {
  ...queryWorkersDriverRegistry,
  motherduck: motherDuckQueryDriver,
  mysql: mysqlQueryDriver,
  postgres: postgresQueryDriver,
  snowflake: snowflakeQueryDriver,
} as const satisfies NodeBaseProviderRegistry;

export function createQueryNodeDriverRegistry(input: {
  athenaConnector: AthenaConnectorQueryDriverDependencies;
}): NodeProviderRegistry {
  return {
    ...queryNodeDriverRegistry,
    aws_athena_connector: createAthenaConnectorQueryDriver(
      input.athenaConnector
    ),
  };
}

export function createQueryNodeRuntime(): QueryNodeRuntime<NodeBaseQueryCredentials>;
export function createQueryNodeRuntime(input: {
  athenaConnector: AthenaConnectorQueryDriverDependencies;
}): QueryNodeRuntime<NodeQueryCredentials>;
export function createQueryNodeRuntime<
  Credentials extends DatabaseCredentials,
>(input: {
  registry: ProviderRegistry<Credentials>;
}): QueryNodeRuntime<Credentials>;
export function createQueryNodeRuntime(
  input?:
    | {
        athenaConnector: AthenaConnectorQueryDriverDependencies;
      }
    | {
        registry: ProviderRegistry<DatabaseCredentials>;
      }
):
  | QueryNodeRuntime<NodeBaseQueryCredentials>
  | QueryNodeRuntime<NodeQueryCredentials>
  | QueryNodeRuntime<DatabaseCredentials> {
  if (!input) {
    return createRuntime<NodeBaseQueryCredentials>(queryNodeDriverRegistry);
  }
  if ("registry" in input) {
    return createRuntime(input.registry);
  }
  return createRuntime<NodeQueryCredentials>(
    createQueryNodeDriverRegistry({
      athenaConnector: input.athenaConnector,
    })
  );
}

function createRuntime<Credentials extends DatabaseCredentials>(
  registry: ProviderRegistry<Credentials>
): QueryNodeRuntime<Credentials> {
  return {
    registry,
    service: createQueryService({
      registry,
      validator: createPolyglotSqlValidator(),
    }),
  };
}
