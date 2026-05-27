import type { MySQLCredentials } from "@onequery/db/server";
import { runMySQLConnectionTest } from "@onequery/query-node/providers/mysql/driver";
import type { ConnectionTestOutcome } from "@onequery/query/connection-test";
import { createQueryDeadline } from "@onequery/query/timeout";

import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

export type MySQLConnectionConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: { rejectUnauthorized: boolean };
  connectTimeout: number;
};

type SslMode = MySQLCredentials["sslMode"];

const shouldUseSsl = (sslMode: SslMode): boolean => sslMode !== "disable";

export function buildMySQLConnectionConfig(
  credentials: MySQLCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS,
  useSsl = shouldUseSsl(credentials.sslMode)
): MySQLConnectionConfig {
  const { host, port, database, username, password } = credentials;

  const config: MySQLConnectionConfig = {
    connectTimeout: timeoutSeconds * 1000,
    database,
    host,
    password,
    port,
    user: username,
  };

  if (useSsl) {
    config.ssl = { rejectUnauthorized: true };
  }

  return config;
}

export async function testMySQLConnection(
  credentials: MySQLCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestOutcome> {
  return runMySQLConnectionTest(
    credentials,
    createQueryDeadline(timeoutSeconds * 1000)
  );
}
