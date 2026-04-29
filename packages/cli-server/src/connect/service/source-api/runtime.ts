import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiDescriptor,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";
import {
  SourceApiAdapterNotRegisteredError,
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidatedError,
  SourceApiPermissionDeniedError,
  SourceApiRequestError,
  SourceApiTimeoutError,
} from "@onequery/server/source-api";
import { Result } from "better-result";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import { isCliFailure } from "../../../domain/failures";
import type { AuthenticatedCliConnectRequestContext } from "../../context";
import { createCliSourceNotFoundFailure } from "../errors";
import type { CliServiceResult } from "../result";
import { createCliServiceFailure } from "../result";
import type { CliHonoContext } from "../types";
import type { SourceApiServiceDependencies } from "./dependencies";
import type { SourceApiAccessState, SourceApiFailurePhase } from "./types";

export async function resolveAuthorizedSourceApiAccess(
  input: {
    action: "source_api.describe" | "source_api.execute";
    orgSlug: string;
    requestContext: AuthenticatedCliConnectRequestContext;
    sourceKey: string;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >
): Promise<CliServiceResult<SourceApiAccessState>> {
  return Result.gen(async function* resolveAuthorizedSourceApiAccessFlow() {
    const authorizedOrg = yield* Result.await(
      input.requestContext.resolveAuthorizedOrg({
        action: input.action,
        orgSlug: input.orgSlug,
      })
    );
    const c = input.requestContext.honoContext;
    const source = yield* Result.await(
      requirePreparedCliSourceApiSource(
        {
          authorizedOrg,
          c,
          sourceKey: input.sourceKey,
        },
        dependencies
      )
    );

    return Result.ok({
      actor: buildSourceApiActor({
        authorizedOrg,
        requestId: input.requestContext.requestId,
        session: input.requestContext.session,
      }),
      authorizedOrg,
      c,
      source,
    });
  });
}

export async function resolveSourceApiDescriptor(
  input: {
    actor: SourceApiActorContext;
    source: PreparedSourceConnection;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "describeSourceApi" | "toCliErrorMessage"
  >
): Promise<CliServiceResult<SourceApiDescriptor>> {
  return trySourceApiPromise(
    {
      operation: () => dependencies.describeSourceApi(input),
      phase: "describe",
    },
    dependencies
  );
}

export async function assertPreparedSourceApiStillValid(
  input: {
    actor: SourceApiActorContext;
    prepared: PreparedSourceApi;
    source: PreparedSourceConnection;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "describeSourceApi" | "toCliErrorMessage"
  >
): Promise<CliServiceResult<void>> {
  return Result.gen(async function* assertPreparedSourceApiStillValidFlow() {
    if (
      input.source.id !== input.prepared.sourceId ||
      input.source.provider !== input.prepared.provider ||
      input.source.sourceKey !== input.prepared.sourceKey
    ) {
      return yield* createSourceApiFailure({
        error: new SourceApiInvalidatedError(
          "Source API execution state no longer matches the current source"
        ),
        phase: "execute",
        renderError: dependencies.toCliErrorMessage,
      });
    }

    if (!input.prepared.descriptorVersion) {
      return Result.ok(undefined);
    }

    const descriptor = yield* Result.await(
      resolveSourceApiDescriptor(
        {
          actor: input.actor,
          source: input.source,
        },
        dependencies
      )
    );

    if (descriptor.descriptorVersion !== input.prepared.descriptorVersion) {
      return yield* createSourceApiFailure({
        error: new SourceApiInvalidatedError(
          "Source API execution state descriptor version no longer matches the current source API descriptor"
        ),
        phase: "execute",
        renderError: dependencies.toCliErrorMessage,
      });
    }

    return Result.ok(undefined);
  });
}

export async function prepareSourceApiDraftResult(
  input: Parameters<SourceApiServiceDependencies["prepareSourceApiDraft"]>[0],
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareSourceApiDraft" | "toCliErrorMessage"
  >
): Promise<CliServiceResult<PreparedSourceApi>> {
  return trySourceApiPromise(
    {
      operation: () => dependencies.prepareSourceApiDraft(input),
      phase: "prepare",
    },
    dependencies
  );
}

export async function executePreparedSourceApiResult(
  input: Parameters<
    SourceApiServiceDependencies["executePreparedSourceApi"]
  >[0],
  dependencies: Pick<
    SourceApiServiceDependencies,
    "executePreparedSourceApi" | "toCliErrorMessage"
  >
): Promise<CliServiceResult<SourceApiExecutionResult>> {
  return trySourceApiPromise(
    {
      operation: () => dependencies.executePreparedSourceApi(input),
      phase: "execute",
    },
    dependencies
  );
}

export function decodeSourceApiContinuationTokenResult(
  input: Parameters<
    SourceApiServiceDependencies["decodeSourceApiContinuationToken"]
  >[0],
  dependencies: Pick<
    SourceApiServiceDependencies,
    "decodeSourceApiContinuationToken" | "toCliErrorMessage"
  >
) {
  return trySourceApi(
    {
      operation: () => dependencies.decodeSourceApiContinuationToken(input),
      phase: "execute",
    },
    dependencies
  );
}

export function createSourceApiFailure(input: {
  error: unknown;
  phase: SourceApiFailurePhase;
  renderError: SourceApiServiceDependencies["toCliErrorMessage"];
}) {
  if (isCliFailure(input.error)) {
    return input.error;
  }

  if (input.error instanceof SourceApiExecutionStageError) {
    return createSourceApiFailure({
      error: input.error.cause,
      phase: input.error.stage,
      renderError: input.renderError,
    });
  }

  const detail = input.renderError(input.error);
  if (input.error instanceof SourceApiPermissionDeniedError) {
    return createCliServiceFailure({
      cause: input.error,
      detail,
      key: "SOURCE_API_FORBIDDEN",
    });
  }

  if (
    input.error instanceof SourceApiExpiredError ||
    input.error instanceof SourceApiInvalidatedError
  ) {
    return createCliServiceFailure({
      cause: input.error,
      detail,
      key: "SOURCE_API_EXECUTION_STATE_INVALID",
    });
  }

  if (input.error instanceof SourceApiAdapterNotRegisteredError) {
    return createCliServiceFailure({
      cause: input.error,
      detail,
      key: "SOURCE_API_SOURCE_UNAVAILABLE",
    });
  }

  if (input.error instanceof SourceApiRequestError) {
    return createCliServiceFailure({
      cause: input.error,
      detail,
      key: "SOURCE_API_REQUEST_INVALID",
    });
  }

  if (input.error instanceof SourceApiTimeoutError) {
    return createCliServiceFailure({
      cause: input.error,
      detail,
      key: "SOURCE_API_EXECUTION_TIMED_OUT",
    });
  }

  return createCliServiceFailure({
    cause: input.error,
    detail,
    key: toSourceApiFailureProblemKey(input.phase),
  });
}

async function requirePreparedCliSourceApiSource(
  input: {
    authorizedOrg: AuthorizedCliOrgContext;
    c: CliHonoContext;
    sourceKey: string;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >
): Promise<CliServiceResult<PreparedSourceConnection>> {
  return Result.gen(async function* requirePreparedCliSourceApiSourceFlow() {
    const source = await dependencies.runCliLoadSourceEffect({
      db: input.c.var.storage.db,
      effect: {
        kind: "load_source",
        organizationId: input.authorizedOrg.org.id,
        sourceKey: input.sourceKey,
      },
    });

    if (source.kind === "not_found") {
      return yield* createCliSourceNotFoundFailure(
        input.authorizedOrg.org.slug,
        input.sourceKey
      );
    }

    const preparedCredentials = yield* (
      await dependencies.prepareDataSourceCredentials({
        dataSource: source.source,
        masterEncryptionKey: input.c.var.runtime.crypto.masterEncryptionKey,
      })
    ).mapError((error) =>
      createCliServiceFailure({
        detail: error.message,
        key: "SOURCE_API_SOURCE_UNAVAILABLE",
        resource: {
          description: "source API credentials could not be prepared",
          name: input.sourceKey,
          owner: input.authorizedOrg.org.slug,
          type: "onequery.cli.source",
        },
      })
    );

    return Result.ok({
      credentials: preparedCredentials.credentials,
      displayName: source.source.displayName,
      id: source.source.id,
      provider: source.source.provider,
      sourceKey: source.source.sourceKey,
    });
  });
}

function buildSourceApiActor(input: {
  authorizedOrg: AuthorizedCliOrgContext;
  requestId: string;
  session: AuthenticatedCliConnectRequestContext["session"];
}): SourceApiActorContext {
  return {
    capabilities: input.authorizedOrg.capabilities,
    membershipRoles: input.authorizedOrg.membershipRoles,
    organizationId: input.authorizedOrg.org.id,
    organizationSlug: input.authorizedOrg.org.slug,
    requestId: input.requestId,
    userId: input.session.user.id,
  };
}

function trySourceApi<T>(
  input: {
    operation: () => T;
    phase: SourceApiFailurePhase;
  },
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
): CliServiceResult<T> {
  return Result.try({
    try: input.operation as () => Awaited<T>,
    catch: (error: unknown) =>
      createSourceApiFailure({
        error,
        phase: input.phase,
        renderError: dependencies.toCliErrorMessage,
      }),
  }) as CliServiceResult<T>;
}

async function trySourceApiPromise<T>(
  input: {
    operation: () => Promise<T>;
    phase: SourceApiFailurePhase;
  },
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
): Promise<CliServiceResult<T>> {
  return Result.tryPromise({
    try: input.operation,
    catch: (error: unknown) =>
      createSourceApiFailure({
        error,
        phase: input.phase,
        renderError: dependencies.toCliErrorMessage,
      }),
  });
}

function toSourceApiFailureProblemKey(phase: SourceApiFailurePhase) {
  switch (phase) {
    case "describe":
      return "SOURCE_API_DESCRIBE_FAILED";
    case "prepare":
      return "SOURCE_API_PREPARATION_FAILED";
    case "authorize":
    case "execute":
      return "SOURCE_API_EXECUTION_FAILED";
  }
}
