import type { WorkflowProjectionJson } from "@onequery/db/server";

export function toWorkflowProjectionJson(
  value: Record<string, unknown>
): WorkflowProjectionJson {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}
