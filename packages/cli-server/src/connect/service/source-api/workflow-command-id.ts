import { createStableValueFingerprint } from "@onequery/server/lib/stable-fingerprint";

import type { StartSourceApiExecuteWorkflowInput } from "./workflow-types";

export function buildStartSourceApiExecuteCommandInvocationId(
  input: Pick<
    StartSourceApiExecuteWorkflowInput,
    "draft" | "invokeMode" | "organizationId" | "requestId" | "sourceKey"
  >
): string {
  const fingerprint = createStableValueFingerprint({
    draft: input.draft,
    invokeMode: input.invokeMode,
    organizationId: input.organizationId,
    sourceKey: input.sourceKey,
    type: "start_invoke",
  });

  return `source_api_action:${input.requestId}:start_invoke:${fingerprint}`;
}

export function buildStartSourceApiDescribeCommandInvocationId(input: {
  organizationId: string;
  requestId: string;
  sourceKey: string;
}): string {
  const fingerprint = createStableValueFingerprint({
    organizationId: input.organizationId,
    sourceKey: input.sourceKey,
    type: "start_describe",
  });

  return `source_api_action:${input.requestId}:start_describe:${fingerprint}`;
}
