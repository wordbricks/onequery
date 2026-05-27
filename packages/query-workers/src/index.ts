import { createQueryService } from "@onequery/query";
import type {
  BigQueryCredentials,
  CloudflareD1Credentials,
  LaminarCredentials,
  ProviderRegistry,
} from "@onequery/query";
import type { SqlValidator } from "@onequery/query/driver";

import { bigQueryQueryDriver } from "./providers/bigquery/driver";
import { cloudflareD1QueryDriver } from "./providers/cloudflare-d1/driver";
import { laminarQueryDriver } from "./providers/laminar/driver";

export type WorkersQueryCredentials =
  | BigQueryCredentials
  | CloudflareD1Credentials
  | LaminarCredentials;

export type WorkersProviderRegistry = ProviderRegistry<WorkersQueryCredentials>;

export type QueryWorkersRuntime = {
  registry: WorkersProviderRegistry;
  service: ReturnType<typeof createQueryService<WorkersQueryCredentials>>;
};

export const queryWorkersDriverRegistry = {
  bigquery: bigQueryQueryDriver,
  cloudflare_d1: cloudflareD1QueryDriver,
  laminar: laminarQueryDriver,
} as const satisfies WorkersProviderRegistry;

export function createQueryWorkersRuntime(input: {
  registry?: WorkersProviderRegistry;
  validator: SqlValidator;
}): QueryWorkersRuntime {
  const registry = input.registry ?? queryWorkersDriverRegistry;
  return {
    registry,
    service: createQueryService({
      registry,
      validator: input.validator,
    }),
  };
}

export * from "./bigquery-client";
export * from "./bigquery-datasets";
export * from "./bigquery-pricing";
export * from "./providers/bigquery/driver";
export * from "./providers/cloudflare-d1/driver";
export * from "./providers/laminar/driver";
export * from "./providers/laminar/errors";
