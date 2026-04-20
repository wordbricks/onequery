import { Result } from "better-result";

import { liftAuthenticatedCliServiceMethod } from "../authenticated";
import type { AuthenticatedCliResultServiceMethod } from "../authenticated";
import type { CliServiceMethod } from "../types";
import { buildCliDescribeSourceApiResponse } from "./codec";
import { resolveSourceApiWorkflowContext } from "./context";
import { resolveSourceApiServiceDependencies } from "./dependencies";
import type { SourceApiServiceDependencies } from "./dependencies";
import { runDescribeSourceApiWorkflowResult } from "./workflow";

export function createHandleDescribeSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"describeSourceApi"> {
  const resolvedDependencies =
    resolveSourceApiServiceDependencies(dependencies);

  const handleDescribeSourceApiImpl: AuthenticatedCliResultServiceMethod<
    "describeSourceApi"
  > = async (request, requestContext) =>
    Result.gen(async function* handleDescribeSourceApiFlow() {
      const workflowContext = yield* Result.await(
        resolveSourceApiWorkflowContext({
          action: "source_api.describe",
          orgSlug: request.orgSlug,
          requestContext,
        })
      );
      const descriptor = yield* Result.await(
        runDescribeSourceApiWorkflowResult({
          ...workflowContext,
          dependencies: resolvedDependencies,
          sourceKey: request.sourceKey,
        })
      );

      resolvedDependencies.logCliEvent({
        details: resolvedDependencies.buildCliRequestLogDetails(
          workflowContext.c,
          {
            operationCount: descriptor.operations.length,
            orgSlug: workflowContext.orgSlug,
            provider: descriptor.source.provider,
            roles: workflowContext.actor.membershipRoles,
            sourceKey: descriptor.source.sourceKey,
          }
        ),
        event: "source_api.describe.resolved",
        level: "info",
      });

      return Result.ok(buildCliDescribeSourceApiResponse(descriptor));
    });

  return liftAuthenticatedCliServiceMethod(handleDescribeSourceApiImpl);
}

export const handleDescribeSourceApi = createHandleDescribeSourceApi();
