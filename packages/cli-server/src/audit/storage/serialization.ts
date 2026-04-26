import type { WorkflowProjectionJson } from "@onequery/db/server";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";
import { z } from "zod";

import type { SharedWorkflowRejectCode, WorkflowFamily } from "../kernel";
import { SHARED_WORKFLOW_REJECT_CODES } from "../kernel";
import { WorkflowStorageCorruptRowError } from "./errors";
import type { WorkflowActionRepairAnchor } from "./types";

export function parseStoredWorkflowValue<Schema extends z.ZodType>(input: {
  actionId?: string;
  entity: string;
  family: WorkflowFamily;
  repairAnchor?: WorkflowActionRepairAnchor | null;
  schema: Schema;
  value: unknown;
}): ResultType<z.infer<Schema>, WorkflowStorageCorruptRowError> {
  const parsed = input.schema.safeParse(input.value);

  if (parsed.success) {
    return Result.ok(parsed.data);
  }

  return Result.err(
    new WorkflowStorageCorruptRowError({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      cause: parsed.error,
      entity: input.entity,
      family: input.family,
      ...(input.repairAnchor === undefined
        ? {}
        : { repairAnchor: input.repairAnchor }),
    })
  );
}

export function parseStoredSharedRejectCode(
  family: WorkflowFamily,
  value: string | null
): ResultType<SharedWorkflowRejectCode, WorkflowStorageCorruptRowError> {
  return parseStoredWorkflowValue({
    entity: "workflow_command_reject_code",
    family,
    schema: z.enum(SHARED_WORKFLOW_REJECT_CODES),
    value,
  });
}

export function toWorkflowProjectionJson(
  value: Record<string, unknown>
): WorkflowProjectionJson {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}
