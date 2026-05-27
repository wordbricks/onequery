import type { Database } from "@onequery/db/server";
import type { DatabaseCredentials, ProviderRegistry } from "@onequery/query";
import {
  createQueryNodeDriverRegistry,
  createQueryNodeRuntime,
} from "@onequery/query-node";
import type {
  ConnectorAthenaJobQueue,
  ConnectorAthenaJobQueueFailure,
} from "@onequery/query-node/providers/athena-connector/driver";

import {
  ConnectorJobTimeoutError,
  queueConnectorAthenaJob,
} from "./connectors/broker";

const queueServerConnectorAthenaJob: ConnectorAthenaJobQueue = async (
  input
) => {
  const outcome = await queueConnectorAthenaJob({
    ...(input.context.db ? { db: input.context.db as Database } : {}),
    connectorId: input.connectorId,
    database: input.database,
    maxRows: input.maxRows,
    organizationId: input.organizationId,
    sql: input.sql,
    timeoutMs: input.timeoutMs,
    waitTimeoutMs: input.waitTimeoutMs,
    workgroup: input.workgroup,
  });

  return outcome.mapError(
    (error): ConnectorAthenaJobQueueFailure => ({
      cause: error,
      message: error.message,
      status: error.status,
      timedOut: error instanceof ConnectorJobTimeoutError,
    })
  );
};

export const serverQueryDriverRegistry = createQueryNodeDriverRegistry({
  athenaConnector: {
    queueJob: queueServerConnectorAthenaJob,
  },
}) satisfies ProviderRegistry;

export const serverQueryRuntime = createQueryNodeRuntime({
  registry: serverQueryDriverRegistry,
});

export function getServerQueryDriver<
  Provider extends DatabaseCredentials["type"],
>(provider: Provider): ProviderRegistry[Provider] {
  return serverQueryDriverRegistry[provider];
}
