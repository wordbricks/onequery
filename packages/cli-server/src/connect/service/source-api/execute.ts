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
import type { CliServiceMethod } from "../types";
import {
  buildCliExecuteSourceApiResponse,
  buildSourceApiDraft,
  isCliSourceApiPreviewOnlyMode,
  resolveSourceApiExecuteCommand,
} from "./codec";
import { resolveSourceApiServiceDependencies } from "./dependencies";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  assertPreparedSourceApiStillValid,
  createSourceApiConnectProblem,
  decodeSourceApiContinuationTokenResult,
  executePreparedSourceApiResult,
  prepareSourceApiDraftResult,
  resolveAuthorizedSourceApiAccess,
  resolveSourceApiDescriptor,
} from "./runtime";
import type {
  ExecuteSourceApiResponseInit,
  SourceApiAccessState,
  SourceApiExecuteCommand,
} from "./types";

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
    const access = yield* Result.await(
      resolveExecuteSourceApiAccess(input, dependencies)
    );
    const descriptor = yield* Result.await(
      resolveSourceApiDescriptor(
        {
          actor: access.actor,
          source: access.source,
        },
        dependencies
      )
    );
    const prepared = yield* Result.await(
      prepareSourceApiDraftResult(
        {
          actor: access.actor,
          descriptor,
          draft: buildSourceApiDraft(input.command.draft),
          source: access.source,
        },
        dependencies
      )
    );
    const preview = dependencies.createSourceApiPreview(prepared);

    if (isCliSourceApiPreviewOnlyMode(input.command.mode)) {
      dependencies.logCliEvent({
        details: dependencies.buildCliRequestLogDetails(access.c, {
          kind: preview.kind,
          mode: "preview_only",
          operation: preview.operation,
          orgSlug: access.authorizedOrg.org.slug,
          provider: preview.provider,
          sourceKey: preview.sourceKey,
        }),
        event: "source_api.execute.preview_resolved",
        level: "info",
      });

      return Result.ok(
        buildCliExecuteSourceApiResponse({
          preview,
        })
      );
    }

    const result = yield* Result.await(
      executePreparedSourceApiResult(
        {
          actor: access.actor,
          prepared,
          source: access.source,
        },
        dependencies
      )
    );
    const continuationToken = encodeSourceApiContinuationTokenValue(
      {
        prepared,
        result,
        secret: access.c.var.runtime.crypto.masterEncryptionKey,
      },
      dependencies
    );

    logResolvedSourceApiExecution(
      {
        access,
        mode: "execute",
        result,
      },
      dependencies
    );

    return Result.ok(
      buildCliExecuteSourceApiResponse({
        continuationToken,
        preview,
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

    yield* Result.await(
      assertPreparedSourceApiStillValid(
        {
          actor: access.actor,
          prepared: continuation.prepared,
          source: access.source,
        },
        dependencies
      )
    );
    yield* requireContinuationPaginationSupport(
      continuation.prepared,
      dependencies
    );

    const result = yield* Result.await(
      executePreparedSourceApiResult(
        {
          actor: access.actor,
          continuation: continuation.state,
          prepared: continuation.prepared,
          source: access.source,
        },
        dependencies
      )
    );
    const preview = dependencies.createSourceApiPreview(continuation.prepared);
    const continuationToken = encodeSourceApiContinuationTokenValue(
      {
        prepared: continuation.prepared,
        result,
        secret: access.c.var.runtime.crypto.masterEncryptionKey,
      },
      dependencies
    );

    logResolvedSourceApiExecution(
      {
        access,
        mode: "resume",
        result,
      },
      dependencies
    );

    return Result.ok(
      buildCliExecuteSourceApiResponse({
        continuationToken,
        preview,
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
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
) {
  if (prepared.paginationPolicy === "continuation_token") {
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

function encodeSourceApiContinuationTokenValue(
  input: {
    now?: Date;
    prepared: PreparedSourceApi;
    result: SourceApiExecutionResult;
    secret: string | Uint8Array;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "encodeSourceApiContinuationToken"
  >
): string | undefined {
  if (input.result.nextContinuationState === undefined) {
    return undefined;
  }

  return dependencies.encodeSourceApiContinuationToken({
    now: input.now,
    prepared: input.prepared,
    secret: input.secret,
    state: input.result.nextContinuationState,
  });
}

function logResolvedSourceApiExecution(
  input: {
    access: SourceApiAccessState;
    mode: "execute" | "resume";
    result: SourceApiExecutionResult;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "buildCliRequestLogDetails" | "getCliLogLevelForStatus" | "logCliEvent"
  >
) {
  dependencies.logCliEvent({
    details: dependencies.buildCliRequestLogDetails(input.access.c, {
      mode: input.mode,
      operation: input.result.operation,
      orgSlug: input.access.authorizedOrg.org.slug,
      provider: input.result.source.provider,
      roles: input.access.authorizedOrg.membershipRoles,
      sourceKey: input.result.source.key,
      status: input.result.status,
    }),
    event: "source_api.execute.resolved",
    level: dependencies.getCliLogLevelForStatus(input.result.status),
  });
}
