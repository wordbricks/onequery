import { athenaConnectorQueryDriver } from "../providers/athena-connector/driver";
import { bigQueryQueryDriver } from "../providers/bigquery/driver";
import { cloudflareD1QueryDriver } from "../providers/cloudflare-d1/driver";
import { laminarQueryDriver } from "../providers/laminar/driver";
import { motherDuckQueryDriver } from "../providers/motherduck/driver";
import { mysqlQueryDriver } from "../providers/mysql/driver";
import { postgresQueryDriver } from "../providers/postgres/driver";
import { snowflakeQueryDriver } from "../providers/snowflake/driver";
import type { ProviderRegistry } from "./driver";

export const queryDriverRegistry = {
  aws_athena_connector: athenaConnectorQueryDriver,
  bigquery: bigQueryQueryDriver,
  cloudflare_d1: cloudflareD1QueryDriver,
  laminar: laminarQueryDriver,
  motherduck: motherDuckQueryDriver,
  mysql: mysqlQueryDriver,
  postgres: postgresQueryDriver,
  snowflake: snowflakeQueryDriver,
} as const satisfies ProviderRegistry;

export function getQueryDriver<Provider extends keyof ProviderRegistry>(
  provider: Provider
): ProviderRegistry[Provider] {
  return queryDriverRegistry[provider];
}
