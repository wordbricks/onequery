import {
  ProviderResponseFailure,
  QueryTimeoutFailure,
  toErrorMessage,
} from "@onequery/query/errors";
import { normalizeRecordRows } from "@onequery/query/rows";
import type { QueryDeadline } from "@onequery/query/timeout";
import type { ValidatedSql } from "@onequery/query/types";
import type {
  Connection as SnowflakeConnection,
  FileAndStageBindStatement as SnowflakeFileAndStageBindStatement,
  RowStatement as SnowflakeRowStatement,
  SnowflakeError,
} from "snowflake-sdk";

type SnowflakeStatement =
  | SnowflakeRowStatement
  | SnowflakeFileAndStageBindStatement;

type SnowflakeStatementState =
  | {
      kind: "starting";
    }
  | {
      kind: "running";
      statement: SnowflakeStatement;
      timeout: ReturnType<typeof setTimeout>;
    }
  | {
      kind: "settled";
    };

export function executeSnowflakeStatement(input: {
  connection: SnowflakeConnection;
  deadline: QueryDeadline;
  sql: ValidatedSql | string;
}): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    let state = createStartingState();

    const settle = (result: {
      error?: unknown;
      rows?: Record<string, unknown>[];
    }) => {
      if (isSettledState(state)) {
        return;
      }

      clearTimeout(timeout);

      state = {
        kind: "settled",
      };

      if (result.error) {
        reject(result.error);
        return;
      }

      resolve(result.rows ?? []);
    };

    const timeout = setTimeout(() => {
      if (isSettledState(state)) {
        return;
      }

      if (state.kind === "running") {
        state.statement.cancel(() => {});
      }

      settle({
        error: new QueryTimeoutFailure({
          message: `Snowflake query timed out after ${input.deadline.timeoutMs}ms`,
          provider: "snowflake",
          retryable: true,
          timedOut: true,
        }),
      });
    }, input.deadline.remainingMs());

    try {
      const statement = input.connection.execute({
        complete: (
          error: SnowflakeError | undefined,
          _statement: SnowflakeStatement,
          rows?: unknown[]
        ) => {
          if (error) {
            settle({ error });
            return;
          }

          try {
            settle({ rows: normalizeRecordRows("Snowflake", rows) });
          } catch (normalizationError) {
            settle({
              error: new ProviderResponseFailure({
                cause: normalizationError,
                message: toErrorMessage(normalizationError),
                provider: "snowflake",
                retryable: false,
                timedOut: false,
              }),
            });
          }
        },
        rowMode: "object_with_renamed_duplicated_columns",
        sqlText: input.sql,
      });

      if (isSettledState(state)) {
        return;
      }

      state = {
        kind: "running",
        statement,
        timeout,
      };
    } catch (error) {
      clearTimeout(timeout);
      settle({ error });
    }
  });
}

function createStartingState(): SnowflakeStatementState {
  return {
    kind: "starting",
  };
}

function isSettledState(
  state: SnowflakeStatementState
): state is Extract<SnowflakeStatementState, { kind: "settled" }> {
  return state.kind === "settled";
}
