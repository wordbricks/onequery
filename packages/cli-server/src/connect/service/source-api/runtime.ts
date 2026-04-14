import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiDescriptor,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";
import {
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidatedError,
  SourceApiPermissionDeniedError,
  SourceApiRequestError,
} from "@onequery/server/source-api";
import { Result } from "better-result";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import type { CliSessionIdentity } from "../../../domain/workflows";
import type { CliConnectRequestContext } from "../../context";
import { CliConnectProblem } from "../../error";
import { createCliConnectSourceNotFoundProblem } from "../errors";
import type { CliServiceResult } from "../result";
import { createCliServiceProblem } from "../result";
import type { CliHonoContext } from "../types";
import type { SourceApiServiceDependencies } from "./dependencies";
import type {
  SourceApiAccessState,
  SourceApiConnectFailurePhase,
} from "./types";

export async function resolveAuthorizedSourceApiAccess(
  input: {
    action: "source_api.describe" | "source_api.execute";
    orgSlug: string;
    requestContext: CliConnectRequestContext;
    sourceKey: string;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >
): Promise<CliServiceResult<SourceApiAccessState>> {
  return Result.gen(async function* resolveAuthorizedSourceApiAccessFlow() {
    const session = yield* Result.await(input.requestContext.resolveSession());
    const authorizedOrg = yield* Result.await(
      input.requestContext.resolveAuthorizedOrg({
        action: input.action,
        orgSlug: input.orgSlug,
        session,
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
        session,
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
      return Result.err(
        createSourceApiConnectProblem({
          error: new SourceApiInvalidatedError(
            "Source API execution state no longer matches the current source"
          ),
          phase: "execute",
          renderError: dependencies.toCliErrorMessage,
        })
      );
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
      return Result.err(
        createSourceApiConnectProblem({
          error: new SourceApiInvalidatedError(
            "Source API execution state descriptor version no longer matches the current source API descriptor"
          ),
          phase: "execute",
          renderError: dependencies.toCliErrorMessage,
        })
      );
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

export function createSourceApiConnectProblem(input: {
  error: unknown;
  phase: SourceApiConnectFailurePhase;
  renderError: SourceApiServiceDependencies["toCliErrorMessage"];
}) {
  if (input.error instanceof CliConnectProblem) {
    return input.error;
  }

  if (input.error instanceof SourceApiExecutionStageError) {
    return createSourceApiConnectProblem({
      error: input.error.cause,
      phase: input.error.stage,
      renderError: input.renderError,
    });
  }

  const detail = input.renderError(input.error);
  if (input.error instanceof SourceApiPermissionDeniedError) {
    return createCliServiceProblem({
      cause: input.error,
      detail,
      key: "SOURCE_API_FORBIDDEN",
    });
  }

  if (
    input.error instanceof SourceApiExpiredError ||
    input.error instanceof SourceApiInvalidatedError
  ) {
    return createCliServiceProblem({
      cause: input.error,
      detail,
      key: "SOURCE_API_EXECUTION_STATE_INVALID",
    });
  }

  if (input.error instanceof SourceApiRequestError) {
    return createCliServiceProblem({
      cause: input.error,
      detail,
      key:
        input.phase === "describe"
          ? "SOURCE_REQUEST_INVALID"
          : "EXECUTE_QUERY_REQUEST_INVALID",
    });
  }

  return createCliServiceProblem({
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
      return Result.err(
        createCliConnectSourceNotFoundProblem(
          input.authorizedOrg.org.slug,
          input.sourceKey
        )
      );
    }

    const preparedCredentials = yield* (
      await dependencies.prepareDataSourceCredentials({
        dataSource: source.source,
        masterEncryptionKey: input.c.var.runtime.crypto.masterEncryptionKey,
      })
    ).mapError((error) =>
      createCliServiceProblem({
        detail: error.message,
        key: "SOURCE_API_SOURCE_UNAVAILABLE",
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
  session: CliSessionIdentity;
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
    phase: SourceApiConnectFailurePhase;
  },
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
): CliServiceResult<T> {
  try {
    return Result.ok(input.operation());
  } catch (error: unknown) {
    return Result.err(
      createSourceApiConnectProblem({
        error,
        phase: input.phase,
        renderError: dependencies.toCliErrorMessage,
      })
    );
  }
}

async function trySourceApiPromise<T>(
  input: {
    operation: () => Promise<T>;
    phase: SourceApiConnectFailurePhase;
  },
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
): Promise<CliServiceResult<T>> {
  return Result.tryPromise({
    try: input.operation,
    catch: (error: unknown) =>
      createSourceApiConnectProblem({
        error,
        phase: input.phase,
        renderError: dependencies.toCliErrorMessage,
      }),
  });
}

function toSourceApiFailureProblemKey(phase: SourceApiConnectFailurePhase) {
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
