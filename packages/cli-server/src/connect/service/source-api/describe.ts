import { Result } from "better-result";

import { liftAuthenticatedCliServiceMethod } from "../authenticated";
import type { AuthenticatedCliResultServiceMethod } from "../authenticated";
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

  const handleDescribeSourceApiImpl: AuthenticatedCliResultServiceMethod<
    "describeSourceApi"
  > = async (request, requestContext) =>
    Result.gen(async function* handleDescribeSourceApiFlow() {
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

  return liftAuthenticatedCliServiceMethod(handleDescribeSourceApiImpl);
}

export const handleDescribeSourceApi = createHandleDescribeSourceApi();
