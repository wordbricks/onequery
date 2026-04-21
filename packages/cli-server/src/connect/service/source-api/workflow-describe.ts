import { Result } from "better-result";

import type { CliServiceResult } from "../result";
import { buildStartSourceApiDescribeCommandInvocationId } from "./workflow-command-id";
import { ensureCliServiceProblem } from "./workflow-runtime";
import { runPreparedSourceApiWorkflow } from "./workflow-steps";
import type { DescribeSourceApiWorkflowInput } from "./workflow-types";

export async function runDescribeSourceApiWorkflowResult(
  input: DescribeSourceApiWorkflowInput
): Promise<
  CliServiceResult<import("@onequery/server/source-api").SourceApiDescriptor>
> {
  return Result.tryPromise({
    try: async () => {
      const preparation = await runPreparedSourceApiWorkflow({
        ...input,
        commandInvocationId: buildStartSourceApiDescribeCommandInvocationId({
          organizationId: input.organizationId,
          requestId: input.requestId,
          sourceKey: input.sourceKey,
        }),
        requestDescriptor: () => null,
        startCommandPayload: {
          sourceKey: input.sourceKey,
          type: "start_describe",
        },
      });

      return preparation.descriptor;
    },
    catch: (error) => ensureCliServiceProblem(error),
  });
}
