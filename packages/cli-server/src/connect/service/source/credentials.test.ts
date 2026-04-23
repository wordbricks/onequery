import { create, isFieldSet } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  ConnectSourceAwsAthenaConnectorCredentialsSchema,
  ConnectSourceCredentialsSchema,
  ConnectSourceMySqlCredentialsSchema,
  ConnectSourcePostgresCredentialsSchema,
} from "../../gen/onequery/cli/v1/source_pb";
import { parseConnectSourceCredentials } from "./credentials";

describe("parseConnectSourceCredentials", () => {
  it("defaults the postgres port when edition field presence marks it absent", () => {
    const postgres = create(ConnectSourcePostgresCredentialsSchema, {
      database: "app",
      host: "localhost",
      password: "secret",
      username: "user",
    });

    expect(postgres.port).toBe(0);
    expect(
      isFieldSet(postgres, ConnectSourcePostgresCredentialsSchema.field.port)
    ).toBe(false);

    const result = parseConnectSourceCredentials(
      create(ConnectSourceCredentialsSchema, {
        kind: { case: "postgres", value: postgres },
      })
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      provider: "postgres",
      credentials: {
        type: "postgres",
        database: "app",
        host: "localhost",
        password: "secret",
        port: 5432,
        sslMode: "prefer",
        username: "user",
      },
    });
  });

  it("defaults the mysql port when edition field presence marks it absent", () => {
    const mysql = create(ConnectSourceMySqlCredentialsSchema, {
      database: "app",
      host: "localhost",
      password: "secret",
      username: "user",
    });

    expect(mysql.port).toBe(0);
    expect(
      isFieldSet(mysql, ConnectSourceMySqlCredentialsSchema.field.port)
    ).toBe(false);

    const result = parseConnectSourceCredentials(
      create(ConnectSourceCredentialsSchema, {
        kind: { case: "mysql", value: mysql },
      })
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      provider: "mysql",
      credentials: {
        type: "mysql",
        database: "app",
        host: "localhost",
        password: "secret",
        port: 3306,
        sslMode: "prefer",
        username: "user",
      },
    });
  });

  it("omits athena query overrides when edition field presence marks them absent", () => {
    const athena = create(ConnectSourceAwsAthenaConnectorCredentialsSchema, {
      connectorId: "athena-connector",
      database: "analytics",
    });

    expect(athena.maxRows).toBe(0);
    expect(athena.timeoutMs).toBe(0);
    expect(
      isFieldSet(
        athena,
        ConnectSourceAwsAthenaConnectorCredentialsSchema.field.maxRows
      )
    ).toBe(false);
    expect(
      isFieldSet(
        athena,
        ConnectSourceAwsAthenaConnectorCredentialsSchema.field.timeoutMs
      )
    ).toBe(false);

    const result = parseConnectSourceCredentials(
      create(ConnectSourceCredentialsSchema, {
        kind: { case: "awsAthenaConnector", value: athena },
      })
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      provider: "aws_athena_connector",
      credentials: {
        type: "aws_athena_connector",
        connectorId: "athena-connector",
        database: "analytics",
      },
    });
  });

  it("preserves explicit athena query overrides", () => {
    const athena = create(ConnectSourceAwsAthenaConnectorCredentialsSchema, {
      connectorId: "athena-connector",
      database: "analytics",
      maxRows: 500,
      timeoutMs: 15_000,
      workgroup: "primary",
    });

    expect(
      isFieldSet(
        athena,
        ConnectSourceAwsAthenaConnectorCredentialsSchema.field.maxRows
      )
    ).toBe(true);
    expect(
      isFieldSet(
        athena,
        ConnectSourceAwsAthenaConnectorCredentialsSchema.field.timeoutMs
      )
    ).toBe(true);

    const result = parseConnectSourceCredentials(
      create(ConnectSourceCredentialsSchema, {
        kind: { case: "awsAthenaConnector", value: athena },
      })
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      provider: "aws_athena_connector",
      credentials: {
        type: "aws_athena_connector",
        connectorId: "athena-connector",
        database: "analytics",
        maxRows: 500,
        timeoutMs: 15_000,
        workgroup: "primary",
      },
    });
  });
});
