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
  buildCliPreviewSourceApiResponse,
  buildCliResumeSourceApiResponse,
  buildSourceApiDraft,
  resolveSourceApiResumeCommand,
  resolveSourceApiStartCommand,
} from "./codec";
import { resolveSourceApiWorkflowContext } from "./context";
import { resolveSourceApiServiceDependencies } from "./dependencies";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  createSourceApiFailure,
  decodeSourceApiContinuationTokenResult,
  resolveAuthorizedSourceApiAccess,
} from "./runtime";
import type {
  ExecuteSourceApiResponseInit,
  PreviewSourceApiResponseInit,
  ResumeSourceApiResponseInit,
  SourceApiAccessState,
  SourceApiResumeCommand,
  SourceApiStartCommand,
} from "./types";
import {
  runResumeSourceApiExecuteWorkflowResult,
  runStartSourceApiExecuteWorkflowResult,
} from "./workflow";

export function createHandlePreviewSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"previewSourceApi"> {
  const resolvedDependencies =
    resolveSourceApiServiceDependencies(dependencies);

  const handlePreviewSourceApiImpl: AuthenticatedCliResultServiceMethod<
    "previewSourceApi"
  > = async (request, requestContext) =>
    Result.gen(async function* handlePreviewSourceApiFlow() {
      const command = yield* resolveSourceApiStartCommand(request);
      const response = yield* Result.await(
        handlePreviewSourceApiCommand(
          {
            command,
            requestContext,
          },
          resolvedDependencies
        )
      );

      return Result.ok(response);
    });

  return liftAuthenticatedCliServiceMethod(handlePreviewSourceApiImpl);
}

export function createHandleExecuteSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"executeSourceApi"> {
  const resolvedDependencies =
    resolveSourceApiServiceDependencies(dependencies);

  const handleExecuteSourceApiImpl: AuthenticatedCliResultServiceMethod<
    "executeSourceApi"
  > = async (request, requestContext) =>
    Result.gen(async function* handleExecuteSourceApiFlow() {
      const command = yield* resolveSourceApiStartCommand(request);
      const response = yield* Result.await(
        handleExecuteSourceApiCommand(
          {
            command,
            requestContext,
          },
          resolvedDependencies
        )
      );

      return Result.ok(response);
    });

  return liftAuthenticatedCliServiceMethod(handleExecuteSourceApiImpl);
}

export function createHandleResumeSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"resumeSourceApi"> {
  const resolvedDependencies =
    resolveSourceApiServiceDependencies(dependencies);

  const handleResumeSourceApiImpl: AuthenticatedCliResultServiceMethod<
    "resumeSourceApi"
  > = async (request, requestContext) =>
    Result.gen(async function* handleResumeSourceApiFlow() {
      const command = yield* resolveSourceApiResumeCommand(request);
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
    });

  return liftAuthenticatedCliServiceMethod(handleResumeSourceApiImpl);
}

export const handlePreviewSourceApi = createHandlePreviewSourceApi();
export const handleExecuteSourceApi = createHandleExecuteSourceApi();
export const handleResumeSourceApi = createHandleResumeSourceApi();

async function handlePreviewSourceApiCommand(
  input: {
    command: SourceApiStartCommand;
    requestContext: AuthenticatedCliConnectRequestContext;
  },
  dependencies: SourceApiServiceDependencies
): Promise<CliServiceResult<PreviewSourceApiResponseInit>> {
  return Result.gen(async function* handlePreviewSourceApiCommandFlow() {
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
        invokeMode: "preview_only",
        sourceKey: input.command.target.sourceKey,
      })
    );

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
      buildCliPreviewSourceApiResponse({
        preview: response.preview,
      })
    );
  });
}

async function handleExecuteSourceApiCommand(
  input: {
    command: SourceApiStartCommand;
    requestContext: AuthenticatedCliConnectRequestContext;
  },
  dependencies: SourceApiServiceDependencies
): Promise<CliServiceResult<ExecuteSourceApiResponseInit>> {
  return Result.gen(async function* handleExecuteSourceApiCommandFlow() {
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
        invokeMode: "execute",
        sourceKey: input.command.target.sourceKey,
      })
    );
    const result = response.result;
    if (result === undefined) {
      return Result.err(
        createSourceApiFailure({
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
      response.continuationToken
        ? buildCliExecuteSourceApiResponse({
            continuationToken: response.continuationToken,
            kind: "continued",
            preview: response.preview,
            result,
          })
        : buildCliExecuteSourceApiResponse({
            kind: "completed",
            preview: response.preview,
            result,
          })
    );
  });
}

async function handleResumeSourceApiCommand(
  input: {
    command: SourceApiResumeCommand;
    requestContext: AuthenticatedCliConnectRequestContext;
  },
  dependencies: SourceApiServiceDependencies
): Promise<CliServiceResult<ResumeSourceApiResponseInit>> {
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
        createSourceApiFailure({
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
      response.continuationToken
        ? buildCliResumeSourceApiResponse({
            continuationToken: response.continuationToken,
            kind: "continued",
            preview: response.preview,
            result,
          })
        : buildCliResumeSourceApiResponse({
            kind: "completed",
            preview: response.preview,
            result,
          })
    );
  });
}

async function resolveExecuteSourceApiAccess(
  input: {
    command: SourceApiResumeCommand;
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
    createSourceApiFailure({
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
