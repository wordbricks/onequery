import type {
  Connection as SnowflakeConnection,
  ConnectionOptions as SnowflakeConnectionOptions,
  RowStatement as SnowflakeRowStatement,
  SnowflakeError,
  StatementOption as SnowflakeStatementOption,
} from "snowflake-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

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

    const result = await executeSnowflakeQuery(
      snowflakeCredentials,
      "SELECT 1",
      1000,
      {
        createConnection,
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ one: 1 }]);
    }
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

    await vi.advanceTimersByTimeAsync(1000);

    const result = await query;
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        _tag: "QueryTimeoutFailure",
        message: "Snowflake query timed out after 1000ms",
        retryable: true,
        timedOut: true,
      });
    }
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

    const result = await executeSnowflakeQuery(
      snowflakeCredentials,
      "SELECT 1",
      1000,
      {
        createConnection: () => connection,
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("warehouse is suspended");
    }

    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });
});
