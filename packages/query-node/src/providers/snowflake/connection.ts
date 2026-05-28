import type { SnowflakeCredentials } from "@onequery/query";
import type { QueryDeadline } from "@onequery/query/timeout";
import type { ValidatedSql } from "@onequery/query/types";
import type {
  Connection as SnowflakeConnection,
  ConnectionOptions as SnowflakeConnectionOptions,
} from "snowflake-sdk";

import { executeSnowflakeStatement } from "./statement-machine";

export type SnowflakeConnectionFactory = (
  options: SnowflakeConnectionOptions
) => SnowflakeConnection;

export type SnowflakeQueryDependencies = {
  createConnection?: SnowflakeConnectionFactory;
};

export type SnowflakeSession = {
  execute(input: {
    sql: ValidatedSql | string;
    deadline: QueryDeadline;
  }): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};

export type SnowflakeTransport = {
  open(input: {
    credentials: SnowflakeCredentials;
    deadline: QueryDeadline;
  }): Promise<SnowflakeSession>;
};

export function createSnowflakeTransport(
  dependencies: SnowflakeQueryDependencies = {}
): SnowflakeTransport {
  return {
    open: async ({ credentials, deadline }) => {
      const createConnection =
        dependencies.createConnection ??
        (await loadSnowflakeSdk()).createConnection;
      const connection = createConnection(
        buildSnowflakeConnectionOptions(credentials, deadline.timeoutMs)
      );
      await connection.connectAsync();

      return {
        execute: async ({ sql, deadline: statementDeadline }) =>
          executeSnowflakeStatement({
            connection,
            deadline: statementDeadline,
            sql,
          }),
        close: async () => {
          await destroySnowflakeConnection(connection);
        },
      };
    },
  };
}

async function loadSnowflakeSdk(): Promise<typeof import("snowflake-sdk")> {
  return import("snowflake-sdk");
}

function buildSnowflakeConnectionOptions(
  creds: SnowflakeCredentials,
  timeoutMs: number
): SnowflakeConnectionOptions {
  const options: SnowflakeConnectionOptions = {
    account: creds.account,
    application: "OneQuery",
    authenticator: "SNOWFLAKE",
    clientSessionKeepAlive: false,
    database: creds.database,
    password: creds.password,
    queryTag: "onequery",
    timeout: timeoutMs,
    username: creds.username,
    validateDefaultParameters: true,
    warehouse: creds.warehouse,
  };

  if (creds.schema) {
    options.schema = creds.schema;
  }
  if (creds.role) {
    options.role = creds.role;
  }

  return options;
}

function destroySnowflakeConnection(
  connection: SnowflakeConnection
): Promise<void> {
  return new Promise((resolve) => {
    connection.destroy(() => {
      resolve();
    });
  });
}
