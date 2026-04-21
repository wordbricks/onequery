import type {
  PreparedSourceApi,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";
import { SourceApiInvalidRequestError } from "@onequery/server/source-api";
import { Result } from "better-result";

import type { AuthenticatedCliConnectRequestContext } from "../../context";
import { liftAuthenticatedCliServiceMethod } from "../authenticated";
import type { AuthenticatedCliResultServiceMethod } from "../authenticated";
import type { CliServiceResult } from "../result";
import type { CliHonoContext, CliServiceMethod } from "../types";
import {
  buildCliExecuteSourceApiResponse,
  buildSourceApiDraft,
  isCliSourceApiPreviewOnlyMode,
  resolveSourceApiExecuteCommand,
} from "./codec";
import { resolveSourceApiWorkflowContext } from "./context";
import { resolveSourceApiServiceDependencies } from "./dependencies";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  createSourceApiConnectProblem,
  decodeSourceApiContinuationTokenResult,
  resolveAuthorizedSourceApiAccess,
} from "./runtime";
import type {
  ExecuteSourceApiResponseInit,
  SourceApiAccessState,
  SourceApiExecuteCommand,
} from "./types";
import {
  runResumeSourceApiExecuteWorkflowResult,
  runStartSourceApiExecuteWorkflowResult,
} from "./workflow";

type StartSourceApiExecuteCommand = Extract<
  SourceApiExecuteCommand,
  { kind: "start" }
>;

type ResumeSourceApiExecuteCommand = Extract<
  SourceApiExecuteCommand,
  { kind: "resume" }
>;

export function createHandleExecuteSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"executeSourceApi"> {
  const resolvedDependencies =
    resolveSourceApiServiceDependencies(dependencies);

  const handleExecuteSourceApiImpl: AuthenticatedCliResultServiceMethod<
    "executeSourceApi"
  > = async (request, requestContext) =>
    Result.gen(async function* handleExecuteSourceApiFlow() {
      const command = yield* resolveSourceApiExecuteCommand(request.input);

      switch (command.kind) {
        case "start": {
          const response = yield* Result.await(
            handleStartSourceApiCommand(
              {
                command,
                requestContext,
              },
              resolvedDependencies
            )
          );

          return Result.ok(response);
        }
        case "resume": {
          const response = yield* Result.await(
            handleResumeSourceApiCommand(
              {
                command,
                requestContext,
              },
              resolvedDependencies
            )
          );

          return Result.ok(response);
        }
      }
    });

  return liftAuthenticatedCliServiceMethod(handleExecuteSourceApiImpl);
}

export const handleExecuteSourceApi = createHandleExecuteSourceApi();

async function handleStartSourceApiCommand(
  input: {
    command: StartSourceApiExecuteCommand;
    requestContext: AuthenticatedCliConnectRequestContext;
  },
  dependencies: SourceApiServiceDependencies
): Promise<CliServiceResult<ExecuteSourceApiResponseInit>> {
  return Result.gen(async function* handleStartSourceApiCommandFlow() {
    const workflowContext = yield* Result.await(
      resolveSourceApiWorkflowContext({
        action: "source_api.execute",
        orgSlug: input.command.target.orgSlug,
        requestContext: input.requestContext,
      })
    );
    const response = yield* Result.await(
      runStartSourceApiExecuteWorkflowResult({
        ...workflowContext,
        dependencies,
        draft: buildSourceApiDraft(input.command.draft),
        invokeMode: isCliSourceApiPreviewOnlyMode(input.command.mode)
          ? "preview_only"
          : "execute",
        sourceKey: input.command.target.sourceKey,
      })
    );

    if (isCliSourceApiPreviewOnlyMode(input.command.mode)) {
      dependencies.logCliEvent({
        details: dependencies.buildCliRequestLogDetails(workflowContext.c, {
          kind: response.preview.kind,
          mode: "preview_only",
          operation: response.preview.operation,
          orgSlug: workflowContext.orgSlug,
          provider: response.preview.source.provider,
          sourceKey: response.preview.source.sourceKey,
        }),
        event: "source_api.execute.preview_resolved",
        level: "info",
      });

      return Result.ok(
        buildCliExecuteSourceApiResponse({
          preview: response.preview,
        })
      );
    }

    const result = response.result;
    if (result === undefined) {
      return Result.err(
        createSourceApiConnectProblem({
          error: new Error(
            "source_api_action execute completed without an execution result"
          ),
          phase: "execute",
          renderError: dependencies.toCliErrorMessage,
        })
      );
    }

    logResolvedSourceApiExecution(
      {
        c: workflowContext.c,
        mode: "execute",
        orgSlug: workflowContext.orgSlug,
        result,
        roles: workflowContext.actor.membershipRoles,
      },
      dependencies
    );

    return Result.ok(
      buildCliExecuteSourceApiResponse({
        continuationToken: response.continuationToken,
        preview: response.preview,
        result,
      })
    );
  });
}

async function handleResumeSourceApiCommand(
  input: {
    command: ResumeSourceApiExecuteCommand;
    requestContext: AuthenticatedCliConnectRequestContext;
  },
  dependencies: SourceApiServiceDependencies
): Promise<CliServiceResult<ExecuteSourceApiResponseInit>> {
  return Result.gen(async function* handleResumeSourceApiCommandFlow() {
    const access = yield* Result.await(
      resolveExecuteSourceApiAccess(input, dependencies)
    );
    const continuation = yield* decodeSourceApiContinuationTokenResult(
      {
        now: new Date(),
        secret: access.c.var.runtime.crypto.masterEncryptionKey,
        token: input.command.continuationToken,
      },
      dependencies
    );

    yield* requireContinuationPaginationSupport(
      continuation.prepared,
      continuation.state,
      dependencies
    );

    const workflowContext = yield* Result.await(
      resolveSourceApiWorkflowContext({
        action: "source_api.execute",
        orgSlug: input.command.target.orgSlug,
        requestContext: input.requestContext,
      })
    );
    const response = yield* Result.await(
      runResumeSourceApiExecuteWorkflowResult({
        ...workflowContext,
        continuation,
        dependencies,
        source: access.source,
      })
    );
    const result = response.result;
    if (result === undefined) {
      return Result.err(
        createSourceApiConnectProblem({
          error: new Error(
            "source_api_action resume completed without an execution result"
          ),
          phase: "execute",
          renderError: dependencies.toCliErrorMessage,
        })
      );
    }

    logResolvedSourceApiExecution(
      {
        c: access.c,
        mode: "resume",
        orgSlug: access.authorizedOrg.org.slug,
        result,
        roles: access.authorizedOrg.membershipRoles,
      },
      dependencies
    );

    return Result.ok(
      buildCliExecuteSourceApiResponse({
        continuationToken: response.continuationToken,
        preview: response.preview,
        result,
      })
    );
  });
}

async function resolveExecuteSourceApiAccess(
  input: {
    command: SourceApiExecuteCommand;
    requestContext: AuthenticatedCliConnectRequestContext;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >
): Promise<CliServiceResult<SourceApiAccessState>> {
  return resolveAuthorizedSourceApiAccess(
    {
      action: "source_api.execute",
      orgSlug: input.command.target.orgSlug,
      requestContext: input.requestContext,
      sourceKey: input.command.target.sourceKey,
    },
    dependencies
  );
}

function requireContinuationPaginationSupport(
  prepared: PreparedSourceApi,
  continuationState: SourceApiExecutionResult["nextContinuationState"] | null,
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
) {
  if (
    continuationState === null ||
    prepared.paginationPolicy === "continuation_token"
  ) {
    return Result.ok(undefined);
  }

  return Result.err(
    createSourceApiConnectProblem({
      error: new SourceApiInvalidRequestError(
        `Source API operation "${prepared.operation}" does not support continuation_token resume`
      ),
      phase: "execute",
      renderError: dependencies.toCliErrorMessage,
    })
  );
}

function logResolvedSourceApiExecution(
  input: {
    c: CliHonoContext;
    mode: "execute" | "resume";
    orgSlug: string;
    result: SourceApiExecutionResult;
    roles: readonly string[];
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "buildCliRequestLogDetails" | "getCliLogLevelForStatus" | "logCliEvent"
  >
) {
  dependencies.logCliEvent({
    details: dependencies.buildCliRequestLogDetails(input.c, {
      mode: input.mode,
      operation: input.result.operation,
      orgSlug: input.orgSlug,
      provider: input.result.source.provider,
      roles: input.roles,
      sourceKey: input.result.source.sourceKey,
      status: input.result.status,
    }),
    event: "source_api.execute.resolved",
    level: dependencies.getCliLogLevelForStatus(input.result.status),
  });
}
