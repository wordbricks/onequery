import { Result } from "better-result";

import type { CliResultServiceMethod } from "../result";
import { liftCliServiceMethod } from "../result";
import type { CliServiceMethod } from "../types";
import { buildCliDescribeSourceApiResponse } from "./codec";
import { resolveSourceApiServiceDependencies } from "./dependencies";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  resolveAuthorizedSourceApiAccess,
  resolveSourceApiDescriptor,
} from "./runtime";

export function createHandleDescribeSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"describeSourceApi"> {
  const resolvedDependencies =
    resolveSourceApiServiceDependencies(dependencies);

  const handleDescribeSourceApiImpl: CliResultServiceMethod<
    "describeSourceApi"
  > = async (request, context) =>
    Result.gen(async function* handleDescribeSourceApiFlow() {
      const requestContext =
        resolvedDependencies.requireCliConnectRequestContext(context);
      const access = yield* Result.await(
        resolveAuthorizedSourceApiAccess(
          {
            action: "source_api.describe",
            orgSlug: request.orgSlug,
            requestContext,
            sourceKey: request.sourceKey,
          },
          resolvedDependencies
        )
      );
      const descriptor = yield* Result.await(
        resolveSourceApiDescriptor(
          {
            actor: access.actor,
            source: access.source,
          },
          resolvedDependencies
        )
      );

      resolvedDependencies.logCliEvent({
        details: resolvedDependencies.buildCliRequestLogDetails(access.c, {
          operationCount: descriptor.operations.length,
          orgSlug: access.authorizedOrg.org.slug,
          provider: descriptor.source.provider,
          roles: access.authorizedOrg.membershipRoles,
          sourceKey: descriptor.source.key,
        }),
        event: "source_api.describe.resolved",
        level: "info",
      });

      return Result.ok(buildCliDescribeSourceApiResponse(descriptor));
    });

  return liftCliServiceMethod(handleDescribeSourceApiImpl);
}

export const handleDescribeSourceApi = createHandleDescribeSourceApi();
