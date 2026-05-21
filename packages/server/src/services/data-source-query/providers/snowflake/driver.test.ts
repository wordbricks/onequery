import type {
  Connection as SnowflakeConnection,
  ConnectionOptions as SnowflakeConnectionOptions,
  RowStatement as SnowflakeRowStatement,
  SnowflakeError,
  StatementOption as SnowflakeStatementOption,
} from "snowflake-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataSourceQueryExecutionError } from "../../core/errors";
import { executeSnowflakeQuery } from "./driver";

const snowflakeCredentials = {
  account: "xy12345.us-east-1",
  database: "analytics",
  password: "secret",
  type: "snowflake",
  username: "app",
  warehouse: "compute_wh",
} as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("snowflake query driver", () => {
  it("uses the created connection even when connectAsync resolves without a connection", async () => {
    const statement = {
      cancel: vi.fn(),
    } as unknown as SnowflakeRowStatement;
    const connection = {
      connectAsync: vi.fn(
        async () => undefined as unknown as SnowflakeConnection
      ),
      destroy: vi.fn((callback: () => void) => {
        callback();
      }),
      execute: vi.fn((options: SnowflakeStatementOption) => {
        options.complete?.(undefined, statement, [{ one: 1 }]);
        return statement;
      }),
    } as unknown as SnowflakeConnection;
    const createConnection = vi.fn(
      (_options: SnowflakeConnectionOptions) => connection
    );

    const rows = await executeSnowflakeQuery(
      snowflakeCredentials,
      "SELECT 1",
      1000,
      {
        createConnection,
      }
    );

    expect(rows).toEqual([{ one: 1 }]);
    expect(connection.connectAsync).toHaveBeenCalledTimes(1);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rowMode: "object_with_renamed_duplicated_columns",
        sqlText: "SELECT 1",
      })
    );
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it("cancels the running statement and closes the connection on timeout", async () => {
    vi.useFakeTimers();

    const statement = {
      cancel: vi.fn((callback: () => void) => {
        callback();
      }),
    } as unknown as SnowflakeRowStatement;
    const connection = {
      connectAsync: vi.fn(async () => connection),
      destroy: vi.fn((callback: () => void) => {
        callback();
      }),
      execute: vi.fn((_options: SnowflakeStatementOption) => statement),
    } as unknown as SnowflakeConnection;
    const createConnection = vi.fn(
      (_options: SnowflakeConnectionOptions) => connection
    );

    const query = executeSnowflakeQuery(
      snowflakeCredentials,
      "SELECT SYSTEM$WAIT(10)",
      1000,
      {
        createConnection,
      }
    );
    const expectation = expect(query).rejects.toMatchObject({
      message: "Snowflake query timed out after 1000ms",
      retryable: true,
      timedOut: true,
    } satisfies Partial<DataSourceQueryExecutionError>);

    await vi.advanceTimersByTimeAsync(1000);

    await expectation;
    expect(statement.cancel).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it("closes the connection when statement execution fails", async () => {
    const statement = {
      cancel: vi.fn(),
    } as unknown as SnowflakeRowStatement;
    const connection = {
      connectAsync: vi.fn(async () => connection),
      destroy: vi.fn((callback: () => void) => {
        callback();
      }),
      execute: vi.fn((options: SnowflakeStatementOption) => {
        options.complete?.(
          new Error("warehouse is suspended") as unknown as SnowflakeError,
          statement
        );
        return statement;
      }),
    } as unknown as SnowflakeConnection;

    await expect(
      executeSnowflakeQuery(snowflakeCredentials, "SELECT 1", 1000, {
        createConnection: () => connection,
      })
    ).rejects.toThrow("warehouse is suspended");

    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });
});
