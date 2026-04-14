import type {
  PreparedSourceApi,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";
import { SourceApiInvalidRequestError } from "@onequery/server/source-api";
import { Result } from "better-result";

import type { CliConnectRequestContext } from "../../context";
import type { CliResultServiceMethod, CliServiceResult } from "../result";
import { liftCliServiceMethod } from "../result";
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

  const handleExecuteSourceApiImpl: CliResultServiceMethod<
    "executeSourceApi"
  > = async (request, context) =>
    Result.gen(async function* handleExecuteSourceApiFlow() {
      const requestContext =
        resolvedDependencies.requireCliConnectRequestContext(context);
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

  return liftCliServiceMethod(handleExecuteSourceApiImpl);
}

export const handleExecuteSourceApi = createHandleExecuteSourceApi();

async function handleStartSourceApiCommand(
  input: {
    command: StartSourceApiExecuteCommand;
    requestContext: CliConnectRequestContext;
  },
  dependencies: SourceApiServiceDependencies
): Promise<CliServiceResult<ExecuteSourceApiResponseInit>> {
  return Result.gen(async function* handleStartSourceApiCommandFlow() {
    const access = yield* Result.await(
      resolveAuthorizedSourceApiAccess(
        {
          action: "source_api.execute",
          orgSlug: input.command.draft.orgSlug,
          requestContext: input.requestContext,
          sourceKey: input.command.draft.sourceKey,
        },
        dependencies
      )
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
        access,
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
    requestContext: CliConnectRequestContext;
  },
  dependencies: SourceApiServiceDependencies
): Promise<CliServiceResult<ExecuteSourceApiResponseInit>> {
  return Result.gen(async function* handleResumeSourceApiCommandFlow() {
    const c = input.requestContext.honoContext;
    const continuation = yield* decodeSourceApiContinuationTokenResult(
      {
        now: new Date(),
        secret: c.var.runtime.crypto.masterEncryptionKey,
        token: input.command.continuationToken,
      },
      dependencies
    );
    const access = yield* Result.await(
      resolveAuthorizedSourceApiAccess(
        {
          action: "source_api.execute",
          orgSlug: continuation.organizationSlug,
          requestContext: input.requestContext,
          sourceKey: continuation.prepared.sourceKey,
        },
        dependencies
      )
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
        access,
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
    access: SourceApiAccessState;
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
    organizationSlug: input.access.authorizedOrg.org.slug,
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
