import { WorkflowStorageCorruptRowError } from "../../audit";
import type { CliProblemKey } from "../../domain/problems";
import { createCliServiceFailure } from "./result";

type WorkflowAuditFailureKeys = {
  corrupt: CliProblemKey;
  internal: CliProblemKey;
};

export function createWorkflowAuditFailure(input: {
  cause?: unknown;
  detail: string;
  keys: WorkflowAuditFailureKeys;
}) {
  return createCliServiceFailure({
    ...(input.cause === undefined ? {} : { cause: input.cause }),
    detail: input.detail,
    key: isWorkflowCorruption(input.cause)
      ? input.keys.corrupt
      : input.keys.internal,
  });
}

export function createWorkflowAuditCorruptionFailure(input: {
  cause?: unknown;
  detail: string;
  key: CliProblemKey;
}) {
  return createCliServiceFailure({
    ...(input.cause === undefined ? {} : { cause: input.cause }),
    detail: input.detail,
    key: input.key,
  });
}

function isWorkflowCorruption(cause: unknown): boolean {
  return cause instanceof WorkflowStorageCorruptRowError;
}
