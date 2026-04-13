import type { MessageInitShape } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";
import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  createPreparedSourceApiPreview,
  decodeSourceApiContinuationToken,
  describeSourceApi,
  encodeSourceApiContinuationToken,
  executePreparedSourceApi,
  prepareSourceApiDraft,
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidatedError,
  SourceApiInvalidRequestError,
  SourceApiPermissionDeniedError,
  SourceApiRequestError,
} from "@onequery/server/source-api";
import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiDescriptor,
  SourceApiExecutionResponse,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";

import type { AuthorizedCliOrgContext } from "../../authorization";
import type { CliSessionIdentity } from "../../domain/workflows";
import {
  buildCliRequestLogDetails,
  getCliLogLevelForStatus,
  logCliEvent,
  toCliErrorMessage,
} from "../../observability";
import { runCliLoadSourceEffect } from "../../source/effects";
import { requireCliConnectRequestContext } from "../context";
import { createCliConnectError } from "../error";
import {
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiResponseSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  fromCliSourceApiDraft,
  isCliSourceApiPreviewOnlyMode,
  requireCliSourceApiExecutionStart,
  toCliDescribeSourceApiResponse,
  toCliExecuteSourceApiResponse,
} from "./conversions";
import { throwCliConnectSourceNotFound } from "./errors";
import type { CliHonoContext, CliServiceMethod } from "./types";

type DescribeSourceApiResponseInit = MessageInitShape<
  typeof DescribeSourceApiResponseSchema
>;
type ExecuteSourceApiResponseInit = MessageInitShape<
  typeof ExecuteSourceApiResponseSchema
>;

type SourceApiConnectFailurePhase = "authorize" | "describe" | "execute";

type SourceApiServiceDependencies = {
  buildCliRequestLogDetails: typeof buildCliRequestLogDetails;
  createPreparedSourceApiPreview: typeof createPreparedSourceApiPreview;
  decodeSourceApiContinuationToken: typeof decodeSourceApiContinuationToken;
  describeSourceApi: typeof describeSourceApi;
  encodeSourceApiContinuationToken: typeof encodeSourceApiContinuationToken;
  executePreparedSourceApi: typeof executePreparedSourceApi;
  getCliLogLevelForStatus: typeof getCliLogLevelForStatus;
  logCliEvent: typeof logCliEvent;
  prepareDataSourceCredentials: typeof prepareDataSourceCredentials;
  prepareSourceApiDraft: typeof prepareSourceApiDraft;
  requireCliConnectRequestContext: typeof requireCliConnectRequestContext;
  runCliLoadSourceEffect: typeof runCliLoadSourceEffect;
  toCliErrorMessage: typeof toCliErrorMessage;
};

const sourceApiServiceDependencies: SourceApiServiceDependencies = {
  buildCliRequestLogDetails,
  createPreparedSourceApiPreview,
  decodeSourceApiContinuationToken,
  describeSourceApi,
  encodeSourceApiContinuationToken,
  executePreparedSourceApi,
  getCliLogLevelForStatus,
  logCliEvent,
  prepareDataSourceCredentials,
  prepareSourceApiDraft,
  requireCliConnectRequestContext,
  runCliLoadSourceEffect,
  toCliErrorMessage,
};

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

function buildSourceApiExecutionResponse(input: {
  continuationToken?: string;
  result: SourceApiExecutionResult;
}): SourceApiExecutionResponse {
  return {
    body: input.result.body,
    continuationToken: input.continuationToken,
    contentType: input.result.contentType,
    headers: input.result.headers,
    operation: input.result.operation,
    selector: input.result.selector,
    source: input.result.source,
    status: input.result.status,
  };
}

function encodeSourceApiContinuationTokenValue(
  input: {
    now?: Date;
    organizationSlug: string;
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
    organizationSlug: input.organizationSlug,
    prepared: input.prepared,
    secret: input.secret,
    state: input.result.nextContinuationState,
  });
}

async function resolveSourceApiDescriptor(
  input: {
    actor: SourceApiActorContext;
    source: PreparedSourceConnection;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "describeSourceApi" | "toCliErrorMessage"
  >
): Promise<SourceApiDescriptor> {
  return Promise.resolve()
    .then(() => dependencies.describeSourceApi(input))
    .catch((error: unknown) => {
      throw createSourceApiConnectError({
        error,
        phase: "describe",
        renderError: dependencies.toCliErrorMessage,
      });
    });
}

async function requirePreparedCliSourceApiSource(input: {
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  sourceKey: string;
}): Promise<PreparedSourceConnection>;
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
): Promise<PreparedSourceConnection>;
async function requirePreparedCliSourceApiSource(
  input: {
    authorizedOrg: AuthorizedCliOrgContext;
    c: CliHonoContext;
    sourceKey: string;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  > = sourceApiServiceDependencies
): Promise<PreparedSourceConnection> {
  const source = await dependencies.runCliLoadSourceEffect({
    db: input.c.var.storage.db,
    effect: {
      kind: "load_source",
      organizationId: input.authorizedOrg.org.id,
      sourceKey: input.sourceKey,
    },
  });

  if (source.kind === "not_found") {
    throwCliConnectSourceNotFound(
      input.authorizedOrg.org.slug,
      input.sourceKey
    );
  }

  const credentials = await dependencies.prepareDataSourceCredentials({
    dataSource: source.source,
    masterEncryptionKey: input.c.var.runtime.crypto.masterEncryptionKey,
  });
  if (!credentials.ok) {
    throw createCliConnectError({
      detail: credentials.error,
      key: "SOURCE_API_SOURCE_UNAVAILABLE",
    });
  }

  return {
    credentials: credentials.value.credentials,
    displayName: source.source.displayName,
    id: source.source.id,
    provider: source.source.provider,
    sourceKey: source.source.sourceKey,
  };
}

async function assertPreparedSourceApiStillValid(
  input: {
    actor: SourceApiActorContext;
    prepared: PreparedSourceApi;
    source: PreparedSourceConnection;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "describeSourceApi" | "toCliErrorMessage"
  >
): Promise<void> {
  if (
    input.source.id !== input.prepared.sourceId ||
    input.source.provider !== input.prepared.provider ||
    input.source.sourceKey !== input.prepared.sourceKey
  ) {
    throw new SourceApiInvalidatedError(
      "Source API execution state no longer matches the current source"
    );
  }

  if (!input.prepared.descriptorVersion) {
    return;
  }

  const descriptor = await resolveSourceApiDescriptor(
    {
      actor: input.actor,
      source: input.source,
    },
    dependencies
  );
  if (descriptor.descriptorVersion !== input.prepared.descriptorVersion) {
    throw new SourceApiInvalidatedError(
      "Source API execution state descriptor version no longer matches the current source API descriptor"
    );
  }
}

export function createHandleDescribeSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"describeSourceApi"> {
  const resolvedDependencies = {
    ...sourceApiServiceDependencies,
    ...dependencies,
  } satisfies SourceApiServiceDependencies;

  return async (request, context) => {
    const requestContext =
      resolvedDependencies.requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const session = await requestContext.requireSession();
    const authorizedOrg = await requestContext.requireAuthorizedOrg({
      action: "source_api.describe",
      orgSlug: request.orgSlug,
      session,
    });
    const source = await requirePreparedCliSourceApiSource(
      {
        authorizedOrg,
        c,
        sourceKey: request.sourceKey,
      },
      resolvedDependencies
    );
    const actor = buildSourceApiActor({
      authorizedOrg,
      requestId: requestContext.requestId,
      session,
    });
    const descriptor = await resolveSourceApiDescriptor(
      {
        actor,
        source,
      },
      resolvedDependencies
    );

    resolvedDependencies.logCliEvent({
      details: resolvedDependencies.buildCliRequestLogDetails(c, {
        operationCount: descriptor.operations.length,
        orgSlug: authorizedOrg.org.slug,
        provider: descriptor.source.provider,
        roles: authorizedOrg.membershipRoles,
        sourceKey: descriptor.source.key,
      }),
      event: "source_api.describe.resolved",
      level: "info",
    });

    return toCliDescribeSourceApiResponse(
      descriptor
    ) satisfies DescribeSourceApiResponseInit;
  };
}

export const handleDescribeSourceApi = createHandleDescribeSourceApi();

export function createHandleExecuteSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"executeSourceApi"> {
  const resolvedDependencies = {
    ...sourceApiServiceDependencies,
    ...dependencies,
  } satisfies SourceApiServiceDependencies;

  return async (request, context) => {
    const requestContext =
      resolvedDependencies.requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const session = await requestContext.requireSession();

    try {
      if (request.input.case === "start") {
        const start = requireCliSourceApiExecutionStart(request.input);
        const draft = start.draft;
        const authorizedOrg = await requestContext.requireAuthorizedOrg({
          action: "source_api.execute",
          orgSlug: draft.orgSlug,
          session,
        });
        const source = await requirePreparedCliSourceApiSource(
          {
            authorizedOrg,
            c,
            sourceKey: draft.sourceKey,
          },
          resolvedDependencies
        );
        const actor = buildSourceApiActor({
          authorizedOrg,
          requestId: requestContext.requestId,
          session,
        });
        const descriptor = await resolveSourceApiDescriptor(
          {
            actor,
            source,
          },
          resolvedDependencies
        );
        const prepared = await resolvedDependencies.prepareSourceApiDraft({
          actor,
          descriptor,
          draft: fromCliSourceApiDraft(draft),
          source,
        });
        const preview =
          resolvedDependencies.createPreparedSourceApiPreview(prepared);

        if (isCliSourceApiPreviewOnlyMode(start.mode)) {
          resolvedDependencies.logCliEvent({
            details: resolvedDependencies.buildCliRequestLogDetails(c, {
              kind: preview.kind,
              mode: "preview_only",
              operation: preview.operation,
              orgSlug: authorizedOrg.org.slug,
              provider: preview.provider,
              sourceKey: preview.sourceKey,
            }),
            event: "source_api.execute.preview_resolved",
            level: "info",
          });

          return toCliExecuteSourceApiResponse({
            preview,
          }) satisfies ExecuteSourceApiResponseInit;
        }

        const result = await resolvedDependencies.executePreparedSourceApi({
          actor,
          prepared,
          source,
        });
        const response = buildSourceApiExecutionResponse({
          continuationToken: encodeSourceApiContinuationTokenValue(
            {
              organizationSlug: authorizedOrg.org.slug,
              prepared,
              result,
              secret: c.var.runtime.crypto.masterEncryptionKey,
            },
            resolvedDependencies
          ),
          result,
        });

        resolvedDependencies.logCliEvent({
          details: resolvedDependencies.buildCliRequestLogDetails(c, {
            mode: "execute",
            operation: response.operation,
            orgSlug: authorizedOrg.org.slug,
            provider: response.source.provider,
            roles: authorizedOrg.membershipRoles,
            sourceKey: response.source.key,
            status: response.status,
          }),
          event: "source_api.execute.resolved",
          level: resolvedDependencies.getCliLogLevelForStatus(response.status),
        });

        return toCliExecuteSourceApiResponse({
          continuationToken: response.continuationToken,
          preview,
          result: response,
        }) satisfies ExecuteSourceApiResponseInit;
      }

      if (request.input.case === "resume") {
        const continuation =
          resolvedDependencies.decodeSourceApiContinuationToken({
            now: new Date(),
            secret: c.var.runtime.crypto.masterEncryptionKey,
            token: request.input.value.continuationToken,
          });
        const authorizedOrg = await requestContext.requireAuthorizedOrg({
          action: "source_api.execute",
          orgSlug: continuation.organizationSlug,
          session,
        });
        const source = await requirePreparedCliSourceApiSource(
          {
            authorizedOrg,
            c,
            sourceKey: continuation.prepared.sourceKey,
          },
          resolvedDependencies
        );
        const actor = buildSourceApiActor({
          authorizedOrg,
          requestId: requestContext.requestId,
          session,
        });

        await assertPreparedSourceApiStillValid(
          {
            actor,
            prepared: continuation.prepared,
            source,
          },
          resolvedDependencies
        );

        if (continuation.prepared.paginationPolicy !== "continuation_token") {
          throw new SourceApiInvalidRequestError(
            `Source API operation "${continuation.prepared.operation}" does not support continuation_token resume`
          );
        }

        const result = await resolvedDependencies.executePreparedSourceApi({
          actor,
          continuation: continuation.state,
          prepared: continuation.prepared,
          source,
        });
        const preview = resolvedDependencies.createPreparedSourceApiPreview(
          continuation.prepared
        );
        const response = buildSourceApiExecutionResponse({
          continuationToken: encodeSourceApiContinuationTokenValue(
            {
              organizationSlug: authorizedOrg.org.slug,
              prepared: continuation.prepared,
              result,
              secret: c.var.runtime.crypto.masterEncryptionKey,
            },
            resolvedDependencies
          ),
          result,
        });

        resolvedDependencies.logCliEvent({
          details: resolvedDependencies.buildCliRequestLogDetails(c, {
            mode: "resume",
            operation: response.operation,
            orgSlug: authorizedOrg.org.slug,
            provider: response.source.provider,
            roles: authorizedOrg.membershipRoles,
            sourceKey: response.source.key,
            status: response.status,
          }),
          event: "source_api.execute.resolved",
          level: resolvedDependencies.getCliLogLevelForStatus(response.status),
        });

        return toCliExecuteSourceApiResponse({
          continuationToken: response.continuationToken,
          preview,
          result: response,
        }) satisfies ExecuteSourceApiResponseInit;
      }

      throw createCliConnectError({
        detail: "source API request missing execution input",
        key: "EXECUTE_QUERY_REQUEST_INVALID",
      });
    } catch (error: unknown) {
      throw createSourceApiConnectError({
        error,
        phase: "execute",
        renderError: resolvedDependencies.toCliErrorMessage,
      });
    }
  };
}

export const handleExecuteSourceApi = createHandleExecuteSourceApi();

function createSourceApiConnectError(input: {
  error: unknown;
  phase: SourceApiConnectFailurePhase;
  renderError?: SourceApiServiceDependencies["toCliErrorMessage"];
}) {
  const renderError = input.renderError ?? toCliErrorMessage;
  const { error, phase } = input;

  if (error instanceof ConnectError) {
    return error;
  }

  if (error instanceof SourceApiExecutionStageError) {
    return createSourceApiConnectError({
      error: error.cause,
      phase: error.stage,
      renderError,
    });
  }

  const detail = renderError(error);
  if (error instanceof SourceApiPermissionDeniedError) {
    return createCliConnectError({
      cause: error,
      detail,
      key: "SOURCE_API_FORBIDDEN",
    });
  }

  if (
    error instanceof SourceApiExpiredError ||
    error instanceof SourceApiInvalidatedError
  ) {
    return createCliConnectError({
      cause: error,
      detail,
      key: "SOURCE_API_EXECUTION_STATE_INVALID",
    });
  }

  if (error instanceof SourceApiRequestError) {
    return createCliConnectError({
      cause: error,
      detail,
      key:
        phase === "describe"
          ? "SOURCE_REQUEST_INVALID"
          : "EXECUTE_QUERY_REQUEST_INVALID",
    });
  }

  return createCliConnectError({
    cause: error,
    detail,
    key:
      phase === "describe"
        ? "SOURCE_API_DESCRIBE_FAILED"
        : "SOURCE_API_EXECUTION_FAILED",
  });
}
