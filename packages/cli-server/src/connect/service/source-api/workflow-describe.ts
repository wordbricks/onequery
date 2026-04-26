import { Result } from "better-result";

import type { CliServiceResult } from "../result";
import { buildStartSourceApiDescribeCommandInvocationId } from "./workflow-command-id";
import { captureSourceApiWorkflowResult } from "./workflow-runtime";
import { runPreparedSourceApiWorkflow } from "./workflow-steps";
import type { DescribeSourceApiWorkflowInput } from "./workflow-types";

export async function runDescribeSourceApiWorkflowResult(
  input: DescribeSourceApiWorkflowInput
): Promise<
  CliServiceResult<import("@onequery/server/source-api").SourceApiDescriptor>
> {
  return captureSourceApiWorkflowResult(async () =>
    Result.gen(async function* runDescribeSourceApiWorkflowFlow() {
      const preparation = yield* Result.await(
        captureSourceApiWorkflowResult(() =>
          runPreparedSourceApiWorkflow({
            ...input,
            commandInvocationId: buildStartSourceApiDescribeCommandInvocationId(
              {
                organizationId: input.organizationId,
                requestId: input.requestId,
                sourceKey: input.sourceKey,
              }
            ),
            requestDescriptor: () => null,
            startCommandPayload: {
              sourceKey: input.sourceKey,
              type: "start_describe",
            },
          })
        )
      );

      return Result.ok(preparation.descriptor);
    })
  );
}
