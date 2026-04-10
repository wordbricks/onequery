import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  createPreparedSourceApiPreview,
  decodeOpaquePageToken,
  decodePreparedSourceApiToken,
  encodeOpaquePageToken,
  describeSourceApi,
  encodePreparedSourceApiToken,
  executePreparedSourceApi,
  prepareSourceApiDraft,
  SourceApiDescriptorVersionMismatchError,
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidatedError,
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
import {
  DescribeSourceApiResponseSchema,
  ExecutePreparedSourceApiResponseSchema,
  PrepareSourceApiResponseSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  fromCliSourceApiDraft,
  requireCliSourceApiDraft,
  toCliDescribeSourceApiResponse,
  toCliExecutePreparedSourceApiResponse,
  toCliPrepareSourceApiResponse,
} from "./conversions";
import { throwCliConnectSourceNotFound } from "./errors";
import type { CliHonoContext, CliServiceMethod } from "./types";

type DescribeSourceApiResponseInit = MessageInitShape<
  typeof DescribeSourceApiResponseSchema
>;
type PrepareSourceApiResponseInit = MessageInitShape<
  typeof PrepareSourceApiResponseSchema
>;
type ExecutePreparedSourceApiResponseInit = MessageInitShape<
  typeof ExecutePreparedSourceApiResponseSchema
>;

const DEFAULT_SOURCE_API_PAGE_TOKEN_TTL_MS = 5 * 60_000;

type SourceApiServiceDependencies = {
  buildCliRequestLogDetails: typeof buildCliRequestLogDetails;
  createPreparedSourceApiPreview: typeof createPreparedSourceApiPreview;
  decodeOpaquePageToken: typeof decodeOpaquePageToken;
  decodePreparedSourceApiToken: typeof decodePreparedSourceApiToken;
  describeSourceApi: typeof describeSourceApi;
  encodeOpaquePageToken: typeof encodeOpaquePageToken;
  encodePreparedSourceApiToken: typeof encodePreparedSourceApiToken;
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
  decodeOpaquePageToken,
  decodePreparedSourceApiToken,
  describeSourceApi,
  encodeOpaquePageToken,
  encodePreparedSourceApiToken,
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

function readSourceApiContinuationState(
  input: {
    pageToken?: string;
    prepared: PreparedSourceApi;
    secret: string | Uint8Array;
    now?: Date;
  },
  dependencies: Pick<SourceApiServiceDependencies, "decodeOpaquePageToken">
): SourceApiExecutionResult["nextContinuationState"] {
  if (input.pageToken === undefined) {
    return undefined;
  }

  return dependencies.decodeOpaquePageToken({
    expected: {
      descriptorVersion: input.prepared.descriptorVersion,
      operation: input.prepared.operation,
      preparedBinding: input.prepared.preparedBinding,
      sourceKey: input.prepared.sourceKey,
    },
    now: input.now,
    secret: input.secret,
    token: input.pageToken,
  }).state;
}

function buildSourceApiExecutionResponse(input: {
  result: SourceApiExecutionResult;
  nextPageToken?: string;
}): SourceApiExecutionResponse {
  return {
    body: input.result.body,
    contentType: input.result.contentType,
    headers: input.result.headers,
    nextPageToken: input.nextPageToken,
    operation: input.result.operation,
    selector: input.result.selector,
    source: input.result.source,
    status: input.result.status,
  };
}

function encodeSourceApiNextPageToken(
  input: {
    now?: Date;
    prepared: PreparedSourceApi;
    preparedExpiresAt: string;
    result: SourceApiExecutionResult;
    secret: string | Uint8Array;
  },
  dependencies: Pick<SourceApiServiceDependencies, "encodeOpaquePageToken">
): string | undefined {
  if (input.result.nextContinuationState === undefined) {
    return undefined;
  }

  const now = input.now ?? new Date();
  const preparedExpiresAt = new Date(input.preparedExpiresAt);
  const expiresAtMs = Math.min(
    preparedExpiresAt.getTime(),
    now.getTime() + DEFAULT_SOURCE_API_PAGE_TOKEN_TTL_MS
  );

  return dependencies.encodeOpaquePageToken({
    payload: {
      descriptorVersion: input.prepared.descriptorVersion,
      expiresAt: new Date(expiresAtMs).toISOString(),
      issuedAt: now.toISOString(),
      operation: input.prepared.operation,
      preparedBinding: input.prepared.preparedBinding,
      sourceKey: input.prepared.sourceKey,
      state: input.result.nextContinuationState,
    },
    secret: input.secret,
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
      throw toSourceApiRequestConnectError(
        error,
        dependencies.toCliErrorMessage
      );
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
    throw new ConnectError(credentials.error, Code.FailedPrecondition);
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
      "Prepared source API source no longer matches the current source"
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
      "Prepared source API descriptor version no longer matches the current source API descriptor"
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

export function createHandlePrepareSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"prepareSourceApi"> {
  const resolvedDependencies = {
    ...sourceApiServiceDependencies,
    ...dependencies,
  } satisfies SourceApiServiceDependencies;

  return async (request, context) => {
    const requestContext =
      resolvedDependencies.requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const session = await requestContext.requireSession();
    const draft = requireCliSourceApiDraft(request.draft);
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

    try {
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
      const preparedToken = resolvedDependencies.encodePreparedSourceApiToken({
        organizationSlug: authorizedOrg.org.slug,
        prepared,
        secret: c.var.runtime.crypto.masterEncryptionKey,
      });

      resolvedDependencies.logCliEvent({
        details: resolvedDependencies.buildCliRequestLogDetails(c, {
          kind: preview.kind,
          operation: preview.operation,
          orgSlug: authorizedOrg.org.slug,
          provider: preview.provider,
          sourceKey: preview.sourceKey,
        }),
        event: "source_api.prepare.resolved",
        level: "info",
      });

      return toCliPrepareSourceApiResponse({
        preparedToken,
        preview,
      }) satisfies PrepareSourceApiResponseInit;
    } catch (error: unknown) {
      throw toSourceApiRequestConnectError(
        error,
        resolvedDependencies.toCliErrorMessage
      );
    }
  };
}

export const handlePrepareSourceApi = createHandlePrepareSourceApi();

export function createHandleExecutePreparedSourceApi(
  dependencies: Partial<SourceApiServiceDependencies> = {}
): CliServiceMethod<"executePreparedSourceApi"> {
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
      const preparedToken = resolvedDependencies.decodePreparedSourceApiToken({
        secret: c.var.runtime.crypto.masterEncryptionKey,
        token: request.preparedToken,
      });
      const authorizedOrg = await requestContext.requireAuthorizedOrg({
        action: "source_api.execute",
        orgSlug: preparedToken.organizationSlug,
        session,
      });
      const source = await requirePreparedCliSourceApiSource(
        {
          authorizedOrg,
          c,
          sourceKey: preparedToken.prepared.sourceKey,
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
          prepared: preparedToken.prepared,
          source,
        },
        resolvedDependencies
      );

      if (
        request.pageToken !== undefined &&
        preparedToken.prepared.paginationPolicy !== "opaque_token"
      ) {
        throw new ConnectError(
          `Source API operation "${preparedToken.prepared.operation}" does not support page_token continuation`,
          Code.InvalidArgument
        );
      }

      const continuation = readSourceApiContinuationState(
        {
          now: new Date(),
          pageToken: request.pageToken,
          prepared: preparedToken.prepared,
          secret: c.var.runtime.crypto.masterEncryptionKey,
        },
        resolvedDependencies
      );

      const result = await resolvedDependencies.executePreparedSourceApi({
        actor,
        continuation,
        prepared: preparedToken.prepared,
        source,
      });
      const response = buildSourceApiExecutionResponse({
        nextPageToken: encodeSourceApiNextPageToken(
          {
            now: new Date(),
            prepared: preparedToken.prepared,
            preparedExpiresAt: preparedToken.expiresAt,
            result,
            secret: c.var.runtime.crypto.masterEncryptionKey,
          },
          resolvedDependencies
        ),
        result,
      });

      resolvedDependencies.logCliEvent({
        details: resolvedDependencies.buildCliRequestLogDetails(c, {
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

      return toCliExecutePreparedSourceApiResponse(
        response
      ) satisfies ExecutePreparedSourceApiResponseInit;
    } catch (error: unknown) {
      throw toSourceApiExecuteConnectError(
        error,
        resolvedDependencies.toCliErrorMessage
      );
    }
  };
}

export const handleExecutePreparedSourceApi =
  createHandleExecutePreparedSourceApi();

function toSourceApiRequestConnectError(
  error: unknown,
  renderError: SourceApiServiceDependencies["toCliErrorMessage"] = toCliErrorMessage
) {
  if (error instanceof ConnectError) {
    return error;
  }

  const detail = renderError(error);
  if (error instanceof SourceApiDescriptorVersionMismatchError) {
    return new ConnectError(detail, Code.FailedPrecondition);
  }
  if (
    error instanceof SourceApiExpiredError ||
    error instanceof SourceApiInvalidatedError
  ) {
    return new ConnectError(detail, Code.FailedPrecondition);
  }
  if (error instanceof SourceApiRequestError) {
    return new ConnectError(detail, Code.InvalidArgument);
  }

  return new ConnectError(detail, Code.Unknown);
}

function toSourceApiAuthorizeConnectError(
  error: unknown,
  renderError: SourceApiServiceDependencies["toCliErrorMessage"] = toCliErrorMessage
) {
  if (error instanceof ConnectError) {
    return error;
  }

  if (error instanceof SourceApiPermissionDeniedError) {
    return new ConnectError(renderError(error), Code.PermissionDenied);
  }

  return new ConnectError(renderError(error), Code.Unknown);
}

function toSourceApiExecuteConnectError(
  error: unknown,
  renderError: SourceApiServiceDependencies["toCliErrorMessage"] = toCliErrorMessage
) {
  if (error instanceof ConnectError) {
    return error;
  }
  if (
    error instanceof SourceApiRequestError ||
    error instanceof SourceApiExpiredError ||
    error instanceof SourceApiInvalidatedError
  ) {
    return toSourceApiRequestConnectError(error, renderError);
  }

  if (error instanceof SourceApiExecutionStageError) {
    switch (error.stage) {
      case "prepare":
        return toSourceApiRequestConnectError(error.cause, renderError);
      case "authorize":
        return toSourceApiAuthorizeConnectError(error.cause, renderError);
      case "execute":
        return new ConnectError(renderError(error.cause), Code.Unknown);
    }
  }

  return new ConnectError(renderError(error), Code.Unknown);
}
