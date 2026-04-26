import { WorkflowStorageCorruptRowError } from "../../audit";
import { formatWorkflowStorageCorruptRowDiagnostic } from "../../audit/storage/errors";
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
    detail: formatWorkflowAuditDetail(input.detail, input.cause),
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
    detail: formatWorkflowAuditDetail(input.detail, input.cause),
    key: input.key,
  });
}

function isWorkflowCorruption(cause: unknown): boolean {
  return cause instanceof WorkflowStorageCorruptRowError;
}

function formatWorkflowAuditDetail(detail: string, cause: unknown): string {
  if (!(cause instanceof WorkflowStorageCorruptRowError)) {
    return detail;
  }

  return `${detail} (${formatWorkflowStorageCorruptRowDiagnostic(cause)})`;
}
