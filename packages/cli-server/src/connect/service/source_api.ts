import { fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue, MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  createPreparedSourceApiPreview as createSourceApiPreview,
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
  PreparedSourceApiPreview as DomainSourceApiPreview,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiBodyKind,
  SourceApiDescriptor,
  SourceApiExecutionResult,
  SourceApiFieldPolicy,
  SourceApiHeader,
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
  SourceApiSource,
  SourceApiDraft as DomainSourceApiDraft,
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
  CliSourceApiBodyKind,
  CliSourceApiExecuteMode,
  CliSourceApiInputMode,
  CliSourceApiOperationKind,
  CliSourceApiPaginationPolicy,
  CliSourceApiSelectorKind,
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiResponseSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import type {
  ExecuteSourceApiRequest,
  SourceApiDraft as CliSourceApiDraft,
} from "../gen/onequery/cli/v1/source_api_pb";
import { throwCliConnectSourceNotFound } from "./errors";
import { toCliSourceProvider } from "./source-provider";
import type { CliHonoContext, CliServiceMethod } from "./types";

type DescribeSourceApiResponseInit = MessageInitShape<
  typeof DescribeSourceApiResponseSchema
>;
type ExecuteSourceApiResponseInit = MessageInitShape<
  typeof ExecuteSourceApiResponseSchema
>;
type CliSourceApiPreviewInit = NonNullable<
  ExecuteSourceApiResponseInit["preview"]
>;
type CliSourceApiExecutionResultInit = NonNullable<
  ExecuteSourceApiResponseInit["result"]
>;

type SourceApiConnectFailurePhase = "authorize" | "describe" | "execute";

type SourceApiServiceDependencies = {
  buildCliRequestLogDetails: typeof buildCliRequestLogDetails;
  createSourceApiPreview: typeof createSourceApiPreview;
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
  createSourceApiPreview,
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

function requireCliSourceApiExecutionStart(
  input: ExecuteSourceApiRequest["input"]
) {
  if (input.case === "start" && input.value.draft) {
    return {
      draft: input.value.draft,
      mode: input.value.mode,
    };
  }

  throw createCliConnectError({
    detail: "source API request missing draft payload",
    key: "READ_QUERY_INPUT_INVALID",
  });
}

function isCliSourceApiPreviewOnlyMode(
  value: CliSourceApiExecuteMode
): boolean {
  return value === CliSourceApiExecuteMode.PREVIEW_ONLY;
}

function buildDomainSourceApiDraft(
  request: CliSourceApiDraft
): DomainSourceApiDraft {
  return {
    body: buildDomainSourceApiRequestBody(request.body),
    fieldPatch: request.fieldPatch,
    headers: request.headers.map(buildDomainSourceApiHeader),
    methodOverride: request.methodOverride,
    operation: request.operation,
    selector: request.selector,
  };
}

function buildDomainSourceApiHeader(value: SourceApiHeader) {
  return {
    name: value.name,
    value: value.value,
  };
}

function buildDomainSourceApiRequestBody(
  body: CliSourceApiDraft["body"]
): SourceApiRequestBody {
  switch (body.case) {
    case "jsonBody":
      return {
        kind: "json",
        value: toJson(ValueSchema, body.value),
      };
    case "textBody":
      return {
        kind: "text",
        value: body.value,
      };
    case "binaryBody":
      return {
        kind: "binary",
        value: body.value,
      };
    case undefined:
      return {
        kind: "none",
      };
  }
}

function buildCliDescribeSourceApiResponse(
  value: SourceApiDescriptor
): DescribeSourceApiResponseInit {
  return {
    defaultPathOperation: value.defaultPathOperation,
    descriptorVersion: value.descriptorVersion,
    examples: value.examples.map(buildCliSourceApiExample),
    notes: [...value.notes],
    operations: value.operations.map(buildCliSourceApiOperation),
    source: buildCliSourceApiSource(value.source),
  };
}

function buildCliExecuteSourceApiResponse(input: {
  continuationToken?: string;
  preview: DomainSourceApiPreview;
  result?: SourceApiExecutionResult;
}): ExecuteSourceApiResponseInit {
  return {
    continuationToken: input.continuationToken,
    preview: buildCliSourceApiPreview(input.preview),
    result: input.result
      ? buildCliSourceApiExecutionResult(input.result)
      : undefined,
  };
}

function buildCliSourceApiPreview(
  value: DomainSourceApiPreview
): CliSourceApiPreviewInit {
  return {
    bodyKind: toCliSourceApiBodyKind(value.bodyKind),
    bodyPaths: [...value.bodyPaths],
    headerNames: [...value.headerNames],
    host: value.host,
    kind: toCliSourceApiOperationKind(value.kind),
    method: value.method,
    operation: value.operation,
    paginationPolicy: toCliSourceApiPaginationPolicy(value.paginationPolicy),
    provider: toCliSourceProvider(value.provider),
    selector: value.selector,
    sourceKey: value.sourceKey,
    url: value.url,
  };
}

function buildCliSourceApiExecutionResult(
  value: SourceApiExecutionResult
): CliSourceApiExecutionResultInit {
  return {
    body: buildCliSourceApiResponseBody(value.body),
    contentType: value.contentType,
    headers: value.headers.map(buildDomainSourceApiHeader),
    operation: value.operation,
    selector: value.selector,
    source: buildCliSourceApiSource(value.source),
    status: value.status,
  };
}

function buildCliSourceApiOperation(value: SourceApiOperation) {
  return {
    description: value.description,
    examples: value.examples.map(buildCliSourceApiExample),
    fieldPolicy: buildCliSourceApiFieldPolicy(value.fieldPolicy),
    headerPolicy: {
      allowedNames: [...value.headerPolicy.allowedRequestHeaders],
    },
    kind: toCliSourceApiOperationKind(value.kind),
    methodPolicy: {
      allowedMethods: [...value.methodPolicy.allowedMethods],
      defaultMethod: value.methodPolicy.defaultMethod,
    },
    name: value.name,
    notes: [...value.notes],
    paginationPolicy: toCliSourceApiPaginationPolicy(value.paginationPolicy),
    selectorKind: toCliSourceApiSelectorKind(value.selectorKind),
    selectorLabel: value.selectorLabel,
    summary: value.summary,
  };
}

function buildCliSourceApiFieldPolicy(value: SourceApiFieldPolicy) {
  return {
    acceptsInput: value.acceptsInput,
    inputMode: toCliSourceApiInputMode(value.inputMode),
    mergePatches: value.mergePatches,
    supportsArrayPaths: value.supportsArrayPaths,
    supportsNestedPaths: value.supportsNestedPaths,
    supportsRawFields: value.allowsRawFields,
    supportsTypedFields: value.allowsTypedFields,
  };
}

function buildCliSourceApiExample(
  value: SourceApiOperation["examples"][number]
) {
  return {
    command: value.command,
    description: value.description,
    label: value.label,
  };
}

function buildCliSourceApiResponseBody(
  value: SourceApiResponseBody
): CliSourceApiExecutionResultInit["body"] {
  switch (value.kind) {
    case "json":
      return {
        case: "json",
        value: fromJson(ValueSchema, value.value as JsonValue),
      };
    case "text":
      return {
        case: "text",
        value: value.value,
      };
    case "binary":
      return {
        case: "binary",
        value: value.value,
      };
    case "none":
      return {
        case: undefined,
        value: undefined,
      };
  }
}

function buildCliSourceApiSource(value: SourceApiSource) {
  return {
    displayName: value.displayName ?? undefined,
    key: value.key,
    provider: toCliSourceProvider(value.provider),
  };
}

function toCliSourceApiInputMode(value: SourceApiFieldPolicy["inputMode"]) {
  switch (value) {
    case "none":
      return CliSourceApiInputMode.NONE;
    case "request_object":
      return CliSourceApiInputMode.REQUEST_OBJECT;
    case "request_body":
      return CliSourceApiInputMode.REQUEST_BODY;
  }
}

function toCliSourceApiOperationKind(
  value: SourceApiOperation["kind"]
): CliSourceApiOperationKind {
  switch (value) {
    case "http_request":
      return CliSourceApiOperationKind.HTTP_REQUEST;
    case "structured_request":
      return CliSourceApiOperationKind.STRUCTURED_REQUEST;
  }
}

function toCliSourceApiBodyKind(
  value: SourceApiBodyKind
): CliSourceApiBodyKind {
  switch (value) {
    case "none":
      return CliSourceApiBodyKind.NONE;
    case "json":
      return CliSourceApiBodyKind.JSON;
    case "text":
      return CliSourceApiBodyKind.TEXT;
    case "binary":
      return CliSourceApiBodyKind.BINARY;
  }
}

function toCliSourceApiPaginationPolicy(
  value: SourceApiOperation["paginationPolicy"]
): CliSourceApiPaginationPolicy {
  switch (value) {
    case "none":
      return CliSourceApiPaginationPolicy.NONE;
    case "continuation_token":
      return CliSourceApiPaginationPolicy.CONTINUATION_TOKEN;
  }
}

function toCliSourceApiSelectorKind(
  value: SourceApiOperation["selectorKind"]
): CliSourceApiSelectorKind {
  switch (value) {
    case "none":
      return CliSourceApiSelectorKind.NONE;
    case "path":
      return CliSourceApiSelectorKind.PATH;
    case "identifier":
      return CliSourceApiSelectorKind.IDENTIFIER;
  }
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

    return buildCliDescribeSourceApiResponse(
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
          draft: buildDomainSourceApiDraft(draft),
          source,
        });
        const preview = resolvedDependencies.createSourceApiPreview(prepared);

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

          return buildCliExecuteSourceApiResponse({
            preview,
          }) satisfies ExecuteSourceApiResponseInit;
        }

        const result = await resolvedDependencies.executePreparedSourceApi({
          actor,
          prepared,
          source,
        });
        const continuationToken = encodeSourceApiContinuationTokenValue(
          {
            organizationSlug: authorizedOrg.org.slug,
            prepared,
            result,
            secret: c.var.runtime.crypto.masterEncryptionKey,
          },
          resolvedDependencies
        );

        resolvedDependencies.logCliEvent({
          details: resolvedDependencies.buildCliRequestLogDetails(c, {
            mode: "execute",
            operation: result.operation,
            orgSlug: authorizedOrg.org.slug,
            provider: result.source.provider,
            roles: authorizedOrg.membershipRoles,
            sourceKey: result.source.key,
            status: result.status,
          }),
          event: "source_api.execute.resolved",
          level: resolvedDependencies.getCliLogLevelForStatus(result.status),
        });

        return buildCliExecuteSourceApiResponse({
          continuationToken,
          preview,
          result,
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
        const preview = resolvedDependencies.createSourceApiPreview(
          continuation.prepared
        );
        const continuationToken = encodeSourceApiContinuationTokenValue(
          {
            organizationSlug: authorizedOrg.org.slug,
            prepared: continuation.prepared,
            result,
            secret: c.var.runtime.crypto.masterEncryptionKey,
          },
          resolvedDependencies
        );

        resolvedDependencies.logCliEvent({
          details: resolvedDependencies.buildCliRequestLogDetails(c, {
            mode: "resume",
            operation: result.operation,
            orgSlug: authorizedOrg.org.slug,
            provider: result.source.provider,
            roles: authorizedOrg.membershipRoles,
            sourceKey: result.source.key,
            status: result.status,
          }),
          event: "source_api.execute.resolved",
          level: resolvedDependencies.getCliLogLevelForStatus(result.status),
        });

        return buildCliExecuteSourceApiResponse({
          continuationToken,
          preview,
          result,
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
