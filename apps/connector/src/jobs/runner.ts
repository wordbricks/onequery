import { AthenaQueryExecutionError } from "../aws/athena";
import type { Logger } from "../logger";
import type {
  AthenaQueryErrorResult,
  AthenaQueryJob,
  AthenaQuerySuccessResult,
  ConnectorErrorCode,
} from "../types";
import { toErrorMessage } from "../utils";
import { validateAthenaSql } from "./validation";

type JobExecutionState =
  | { status: "received"; job: AthenaQueryJob }
  | { status: "validated"; job: AthenaQueryJob; sql: string }
  | { status: "executed"; result: AthenaQuerySuccessResult }
  | { status: "failed"; result: AthenaQueryErrorResult }
  | {
      status: "completed";
      result: AthenaQuerySuccessResult | AthenaQueryErrorResult;
    };

type JobExecutionEvent =
  | { type: "validation_passed"; sql: string }
  | {
      type: "validation_failed";
      error: { code: ConnectorErrorCode; message: string };
    }
  | { type: "execution_passed"; result: AthenaQuerySuccessResult }
  | {
      type: "execution_failed";
      error: { code: ConnectorErrorCode; message: string };
    }
  | { type: "finalize" };

export async function runAthenaJob(input: {
  job: AthenaQueryJob;
  athena: {
    executeQuery: (
      input: AthenaQueryInput
    ) => Promise<AthenaQuerySuccessResult>;
  };
  logger: Logger;
}): Promise<AthenaQuerySuccessResult | AthenaQueryErrorResult> {
  let state: JobExecutionState = { job: input.job, status: "received" };

  while (state.status !== "completed") {
    switch (state.status) {
      case "received": {
        const validation = validateAthenaSql(state.job.sql);
        if (validation.isErr()) {
          state = reduce(state, {
            error: validation.error,
            type: "validation_failed",
          });
          break;
        }

        state = reduce(state, {
          sql: validation.value.sql,
          type: "validation_passed",
        });
        break;
      }
      case "validated": {
        const activeState = state;
        try {
          const result = await input.athena.executeQuery({
            database: activeState.job.database,
            jobId: activeState.job.jobId,
            maxRows: activeState.job.maxRows,
            sql: activeState.sql,
            timeoutMs: activeState.job.timeoutMs,
            workgroup: activeState.job.workgroup,
          });

          state = reduce(activeState, {
            result,
            type: "execution_passed",
          });
        } catch (error) {
          const normalized = normalizeExecutionError(error);
          state = reduce(activeState, {
            error: normalized,
            type: "execution_failed",
          });
        }
        break;
      }
      case "executed":
      case "failed": {
        state = reduce(state, { type: "finalize" });
        break;
      }
    }
  }

  if (state.result.status === "error") {
    input.logger.warn("connector.job.failed", {
      code: state.result.error.code,
      jobId: state.result.jobId,
      message: state.result.error.message,
    });
  } else {
    input.logger.info("connector.job.succeeded", {
      executionTimeMs: state.result.stats?.executionTimeMs,
      jobId: state.result.jobId,
      rowCount: state.result.rows.length,
    });
  }

  return state.result;
}

type AthenaQueryInput = {
  jobId: string;
  sql: string;
  database?: string;
  workgroup?: string;
  timeoutMs?: number;
  maxRows?: number;
};

function reduce(
  state: Exclude<JobExecutionState, { status: "completed" }>,
  event: JobExecutionEvent
): JobExecutionState {
  switch (state.status) {
    case "received": {
      if (event.type === "validation_passed") {
        return {
          job: state.job,
          sql: event.sql,
          status: "validated",
        };
      }

      if (event.type === "validation_failed") {
        return {
          result: {
            jobId: state.job.jobId,
            status: "error",
            error: event.error,
          },
          status: "failed",
        };
      }

      return state;
    }
    case "validated": {
      if (event.type === "execution_passed") {
        return {
          result: event.result,
          status: "executed",
        };
      }

      if (event.type === "execution_failed") {
        return {
          result: {
            jobId: state.job.jobId,
            status: "error",
            error: event.error,
          },
          status: "failed",
        };
      }

      return state;
    }
    case "executed": {
      if (event.type === "finalize") {
        return {
          result: state.result,
          status: "completed",
        };
      }

      return state;
    }
    case "failed": {
      if (event.type === "finalize") {
        return {
          result: state.result,
          status: "completed",
        };
      }

      return state;
    }
  }
}

function normalizeExecutionError(error: unknown): {
  code: ConnectorErrorCode;
  message: string;
} {
  if (error instanceof AthenaQueryExecutionError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: toErrorMessage(error),
  };
}
