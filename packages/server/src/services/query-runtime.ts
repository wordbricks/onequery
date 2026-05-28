import type { DatabaseCredentials, ProviderRegistry } from "@onequery/query";
import { createQueryNodeDriverRegistry } from "@onequery/query-node";
import { createConnectorAthenaJobQueueAdapter } from "@onequery/query-node/providers/athena-connector/driver";

import {
  ConnectorJobTimeoutError,
  queueConnectorAthenaJob,
} from "./connectors/broker";

const queueServerConnectorAthenaJob = createConnectorAthenaJobQueueAdapter({
  isTimedOut: (error) => error instanceof ConnectorJobTimeoutError,
  queueJob: queueConnectorAthenaJob,
});

export const serverQueryDriverRegistry = createQueryNodeDriverRegistry({
  athenaConnector: {
    queueJob: queueServerConnectorAthenaJob,
  },
}) satisfies ProviderRegistry;

export function getServerQueryDriver<
  Provider extends DatabaseCredentials["type"],
>(provider: Provider): ProviderRegistry[Provider] {
  return serverQueryDriverRegistry[provider];
}
