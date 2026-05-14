import { create, fromJson, isMessage, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import { organization } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { pgliteTestDb } from "@onequery/db/testing/setup";
import {
  SourceApiBodyKind,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  DescribeSourceApiRequestSchema,
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiRequestSchema,
  ExecuteSourceApiResponseSchema,
  PreviewSourceApiRequestSchema,
  PreviewSourceApiResponseSchema,
  ResumeSourceApiRequestSchema,
  ResumeSourceApiResponseSchema,
} from "@onequery/proto-cli/cli/v1/source_api_pb";
import type {
  DescribeSourceApiResponse,
  ExecuteSourceApiResponse,
  PreviewSourceApiResponse,
  ResumeSourceApiResponse,
} from "@onequery/proto-cli/cli/v1/source_api_pb";
import { ErrorInfoSchema } from "@onequery/proto-cli/google/rpc/error_details_pb";
import {
  SourceApiAdapterNotRegisteredError,
  SourceApiDescriptorVersionMismatchError,
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidRequestError,
  SourceApiPermissionDeniedError,
  SourceApiTimeoutError,
} from "@onequery/server/source-api";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storeSourceApiActionCommand } from "../../audit";
import { cliConnectRequestContextKey } from "../context";
import { CLI_ERROR_INFO_DOMAIN } from "../error";
import { createCliServiceFailure } from "./result";
import {
  createHandleDescribeSourceApi,
  createHandleExecuteSourceApi,
  createHandlePreviewSourceApi,
  createHandleResumeSourceApi,
} from "./source-api";

function summarizeLoadOrgSourceAccessCall(
  call:
    | {
        orgSlug: string;
        sourceKey: string;
        userId: string;
      }
    | undefined
) {
  return call
    ? {
        orgSlug: call.orgSlug,
        sourceKey: call.sourceKey,
        userId: call.userId,
      }
    : null;
}

expect.addSnapshotSerializer({
  serialize(value, config, indentation, depth, refs, printer) {
    const { $typeName: _ignored, ...rest } = value;
    return printer(rest, config, indentation, depth, refs);
  },
  test: isMessage,
});

const session = {
  authMode: "browser_session",
  user: {
    email: "jane@example.com",
    id: "user-1",
  },
} as const;

const authorizedOrg = {
  capabilities: ["source_api.describe", "source_api.execute"],
  membershipRoles: ["owner"],
  org: {
    id: "org-1",
    slug: "acme",
  },
} as const;

const loadedSource = {
  kind: "found",
  source: {
    credentialsEncrypted: "encrypted",
    credentialsIv: "iv",
    displayName: "GitHub Prod",
    id: "source-1",
    name: "github-prod",
    organizationId: authorizedOrg.org.id,
    provider: "github",
    sourceKey: "github-prod",
    status: "active",
  },
} as const;

const preparedSource = {
  credentials: {
    token: "secret",
  },
  displayName: "GitHub Prod",
  id: "source-1",
  provider: "github",
  sourceKey: "github-prod",
} as const;

const descriptor = {
  defaultPathOperation: "fetch",
  descriptorVersion: "github-v1",
  examples: [
    {
      command: "onequery api --source github-prod /issues",
      description: "Fetch issues",
      label: "issues",
    },
  ],
  notes: ["Uses the GitHub REST API."],
  operations: [
    {
      description: "Fetch one GitHub API path.",
      examples: [],
      fieldPolicy: {
        acceptsInput: false,
        allowsRawFields: false,
        allowsTypedFields: false,
        inputMode: "none",
        mergePatches: false,
        supportsArrayPaths: false,
        supportsNestedPaths: false,
      },
      headerPolicy: {
        allowedRequestHeaders: ["accept"],
        allowedResponseHeaders: ["content-type"],
      },
      kind: "http_request",
      methodPolicy: {
        allowedMethods: ["GET"],
        defaultMethod: "GET",
      },
      name: "fetch",
      notes: [],
      paginationPolicy: "none",
      selectorKind: "path",
      selectorLabel: "path",
      summary: "Fetch a GitHub path",
    },
  ],
  source: {
    displayName: "GitHub Prod",
    sourceKey: "github-prod",
    provider: "github",
  },
} as const;

const prepared = {
  body: {
    kind: "text",
    value: "body text",
  },
  bodyKind: "text",
  bodyPaths: [],
  descriptorVersion: "github-v1",
  headerNames: ["accept"],
  headers: [
    {
      name: "accept",
      value: "application/json",
    },
  ],
  host: "api.github.com",
  kind: "http_request",
  method: "POST",
  operation: "fetch",
  paginationPolicy: "none",
  preparedBinding: "prepared_binding_123",
  provider: "github",
  selector: "/issues",
  selectorTemplate: "/{path}",
  sourceId: "source-1",
  sourceKey: "github-prod",
  url: "https://api.github.com/issues",
} as const;

const sourceApiPreview = {
  bodyKind: "text",
  bodyPaths: [],
  headerNames: ["accept"],
  host: "api.github.com",
  kind: "http_request",
  method: "POST",
  operation: "fetch",
  paginationPolicy: "none",
  selector: "/issues",
  source: {
    displayName: "GitHub Prod",
    provider: "github",
    sourceKey: "github-prod",
  },
  url: "https://api.github.com/issues",
} as const;

const decodedContinuationToken = {
  actionId: "action_123",
  expiresAt: "2026-04-10T00:05:00.000Z",
  issuedAt: "2026-04-10T00:00:00.000Z",
  prepared: {
    ...prepared,
    paginationPolicy: "continuation_token",
  },
  preparedRequestFingerprint: prepared.preparedBinding,
  resumeFromEventId: "event_resume_123",
  state: {
    cursor: "page_2",
  },
  version: 3 as const,
};

const executionResponse = {
  body: {
    kind: "text",
    value: "ok",
  },
  contentType: "text/plain",
  headers: [
    {
      name: "content-type",
      value: "text/plain",
    },
  ],
  operation: "fetch",
  selector: "/issues",
  source: {
    displayName: "GitHub Prod",
    sourceKey: "github-prod",
    provider: "github",
  },
  status: 200,
} as const;

async function createHarness() {
  const db = pgliteTestDb;
  await db.insert(organization).values({
    id: authorizedOrg.org.id,
    name: "Acme",
    slug: authorizedOrg.org.slug,
  });

  const honoContext = {
    var: {
      runtime: {
        crypto: {
          masterEncryptionKey: "master-key",
        },
      },
      storage: {
        db,
      },
    },
  } as const;

  const requestContext = {
    honoContext,
    requestId: "req_cli_123",
    resolveAuthorizedOrg: vi.fn().mockResolvedValue(Result.ok(authorizedOrg)),
    resolveSession: vi.fn().mockResolvedValue(Result.ok(session)),
  };
  const dependencies = {
    buildCliRequestLogDetails: vi.fn(
      (_: unknown, details?: Record<string, unknown>) => ({
        method: "POST",
        path: "/connectrpc/onequery.cli.v1.CliSourceApiService/ExecuteSourceApi",
        requestId: "req_cli_123",
        ...(details ?? {}),
      })
    ),
    createSourceApiPreview: vi.fn().mockReturnValue(sourceApiPreview),
    decodeSourceApiContinuationToken: vi
      .fn()
      .mockReturnValue(decodedContinuationToken),
    describeSourceApi: vi.fn().mockResolvedValue(descriptor),
    encodeSourceApiContinuationToken: vi.fn().mockReturnValue("continuation_2"),
    executePreparedSourceApi: vi.fn().mockResolvedValue(executionResponse),
    getCliLogLevelForStatus: vi.fn((): "info" => "info"),
    logCliEvent: vi.fn(),
    prepareDataSourceCredentials: vi.fn().mockResolvedValue(
      Result.ok({
        credentials: preparedSource.credentials,
        refreshed: false,
      })
    ),
    prepareSourceApiDraft: vi.fn().mockResolvedValue(prepared),
    runCliLoadOrgAccessWithSource: vi.fn().mockResolvedValue({
      access: {
        kind: "found",
        org: {
          id: authorizedOrg.org.id,
          name: "Acme",
          slug: authorizedOrg.org.slug,
        },
        rawMembershipRole: "owner",
      },
      source: loadedSource,
    }),
    runCliLoadSourceEffect: vi.fn().mockResolvedValue(loadedSource),
    toCliErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    ),
  };

  return {
    db,
    dependencies,
    handleDescribeSourceApi: createHandleDescribeSourceApi(dependencies),
    handleExecuteSourceApi: createHandleExecuteSourceApi(dependencies),
    handlePreviewSourceApi: createHandlePreviewSourceApi(dependencies),
    handleResumeSourceApi: createHandleResumeSourceApi(dependencies),
    requestContext,
  };
}

async function seedResumableSourceApiAction(db: Database, requestId: string) {
  const startResult = await storeSourceApiActionCommand({
    command: {
      actionId: null,
      actorSnapshot: {
        authMode: session.authMode,
        email: session.user.email,
        membershipRoles: [...authorizedOrg.membershipRoles],
        userId: session.user.id,
      },
      causedByEventId: null,
      commandInvocationId: `${requestId}:start`,
      commandPayload: {
        invokeMode: "execute",
        requestDescriptor: {
          descriptorVersion: "github-v1",
          kind: "http_request",
          method: "POST",
          operation: "fetch",
          paginationPolicy: "continuation_token",
          selector: "/issues",
        },
        sourceKey: "github-prod",
        type: "start_invoke",
      },
      family: "source_api_action",
      observedAt: new Date("2026-04-10T00:00:00.000Z"),
      organizationId: authorizedOrg.org.id,
      requestId,
      surface: "cli",
    },
    db,
  });

  expect(startResult.isOk()).toBe(true);
  if (startResult.isErr() || startResult.value.kind !== "accepted") {
    throw new Error("failed to seed source api start action");
  }

  const startEvent = startResult.value.events.at(-1);
  if (!startEvent) {
    throw new Error("missing source api start event");
  }

  const sourceLoadedResult = await storeSourceApiActionCommand({
    command: {
      actionId: startResult.value.actionId,
      actorSnapshot: {
        authMode: session.authMode,
        email: session.user.email,
        membershipRoles: [...authorizedOrg.membershipRoles],
        userId: session.user.id,
      },
      causedByEventId: startEvent.id,
      commandInvocationId: `${requestId}:source_loaded`,
      commandPayload: {
        kind: "found",
        source: {
          displayName: loadedSource.source.displayName,
          provider: loadedSource.source.provider,
          sourceId: loadedSource.source.id,
          sourceKey: loadedSource.source.sourceKey,
        },
        type: "record_source_lookup",
      },
      family: "source_api_action",
      observedAt: new Date("2026-04-10T00:00:01.000Z"),
      organizationId: authorizedOrg.org.id,
      requestId,
      surface: "system",
    },
    db,
  });

  expect(sourceLoadedResult.isOk()).toBe(true);
  if (
    sourceLoadedResult.isErr() ||
    sourceLoadedResult.value.kind !== "accepted"
  ) {
    throw new Error("failed to seed source api source lookup");
  }

  const sourceLoadedEvent = sourceLoadedResult.value.events.at(-1);
  if (!sourceLoadedEvent) {
    throw new Error("missing source api source_loaded event");
  }

  const descriptorResult = await storeSourceApiActionCommand({
    command: {
      actionId: startResult.value.actionId,
      actorSnapshot: {
        authMode: session.authMode,
        email: session.user.email,
        membershipRoles: [...authorizedOrg.membershipRoles],
        userId: session.user.id,
      },
      causedByEventId: sourceLoadedEvent.id,
      commandInvocationId: `${requestId}:descriptor`,
      commandPayload: {
        descriptor,
        kind: "resolved",
        requestDescriptor: {
          descriptorVersion: "github-v1",
          kind: "http_request",
          method: "POST",
          operation: "fetch",
          paginationPolicy: "continuation_token",
          selector: "/issues",
        },
        type: "record_descriptor_resolution",
      },
      family: "source_api_action",
      observedAt: new Date("2026-04-10T00:00:02.000Z"),
      organizationId: authorizedOrg.org.id,
      requestId,
      surface: "system",
    },
    db,
  });

  expect(descriptorResult.isOk()).toBe(true);
  if (descriptorResult.isErr() || descriptorResult.value.kind !== "accepted") {
    throw new Error("failed to seed source api descriptor");
  }

  const descriptorEvent = descriptorResult.value.events.at(-1);
  if (!descriptorEvent) {
    throw new Error("missing source api descriptor event");
  }

  const preparedResult = await storeSourceApiActionCommand({
    command: {
      actionId: startResult.value.actionId,
      actorSnapshot: {
        authMode: session.authMode,
        email: session.user.email,
        membershipRoles: [...authorizedOrg.membershipRoles],
        userId: session.user.id,
      },
      causedByEventId: descriptorEvent.id,
      commandInvocationId: `${requestId}:prepared`,
      commandPayload: {
        kind: "prepared",
        preparedRequestFingerprint: prepared.preparedBinding,
        type: "record_request_preparation",
      },
      family: "source_api_action",
      observedAt: new Date("2026-04-10T00:00:03.000Z"),
      organizationId: authorizedOrg.org.id,
      requestId,
      surface: "system",
    },
    db,
  });

  expect(preparedResult.isOk()).toBe(true);
  if (preparedResult.isErr() || preparedResult.value.kind !== "accepted") {
    throw new Error("failed to seed source api preparation");
  }

  const preparedEvent = preparedResult.value.events.at(-1);
  if (!preparedEvent) {
    throw new Error("missing source api prepared event");
  }

  const pageFetchResult = await storeSourceApiActionCommand({
    command: {
      actionId: startResult.value.actionId,
      actorSnapshot: {
        authMode: session.authMode,
        email: session.user.email,
        membershipRoles: [...authorizedOrg.membershipRoles],
        userId: session.user.id,
      },
      causedByEventId: preparedEvent.id,
      commandInvocationId: `${requestId}:page_fetch`,
      commandPayload: {
        attemptNumber: 1,
        contentType: "text/plain",
        executionResult: {
          body: {
            kind: "text",
            value: "ok",
          },
          contentType: "text/plain",
          headers: [],
          nextContinuationState: {
            cursor: "next",
          },
          operation: "fetch",
          selector: "/issues",
          source: descriptor.source,
          status: 200,
        },
        hasContinuation: true,
        httpStatus: 200,
        kind: "succeeded",
        pageIndex: 0,
        responseBytes: 2,
        type: "record_page_fetch",
      },
      family: "source_api_action",
      observedAt: new Date("2026-04-10T00:00:04.000Z"),
      organizationId: authorizedOrg.org.id,
      requestId,
      surface: "system",
    },
    db,
  });

  expect(pageFetchResult.isOk()).toBe(true);
  if (pageFetchResult.isErr() || pageFetchResult.value.kind !== "accepted") {
    throw new Error("failed to seed source api page fetch");
  }

  const pageFetchEvent = pageFetchResult.value.events.at(-1);
  if (!pageFetchEvent) {
    throw new Error("missing source api page fetch event");
  }

  return {
    actionId: startResult.value.actionId,
    resumeFromEventId: pageFetchEvent.id,
  };
}

function createHandlerContext(
  requestContext: Awaited<ReturnType<typeof createHarness>>["requestContext"]
) {
  return {
    values: createContextValues().set(
      cliConnectRequestContextKey,
      requestContext as never
    ),
  } as never;
}

function createResumeExecuteSourceApiRequest(
  input: {
    continuationToken?: string;
    orgSlug?: string;
    sourceKey?: string;
  } = {}
) {
  return create(ResumeSourceApiRequestSchema, {
    continuationToken: input.continuationToken ?? "continuation_1",
    target: {
      orgSlug: input.orgSlug ?? "acme",
      sourceKey: input.sourceKey ?? "github-prod",
    },
  });
}

async function expectConnectError(
  promise: Promise<unknown> | unknown,
  input: {
    code: Code;
    message: string;
  }
): Promise<ConnectError> {
  try {
    await Promise.resolve(promise);
    throw new Error("expected ConnectError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConnectError);
    const connectError = error as ConnectError;
    expect(connectError.code).toBe(input.code);
    expect(connectError.message).toContain(input.message);
    return connectError;
  }
}

function summarizeDescribeSourceApiResponse(
  response: DescribeSourceApiResponse
) {
  return {
    defaultPathOperationName: response.defaultPathOperationName ?? null,
    descriptorVersion: response.descriptorVersion,
    examples: response.examples,
    notes: response.notes,
    operations: response.operations.map((operation) => ({
      ...operation,
      kind: SourceApiOperationKind[operation.kind],
      paginationPolicy: SourceApiPaginationPolicy[operation.paginationPolicy],
    })),
    source: response.source
      ? {
          ...response.source,
          provider: response.source.provider,
        }
      : null,
  };
}

function summarizeExecuteSourceApiResponse(response: ExecuteSourceApiResponse) {
  return summarizeSourceApiOutcome(response);
}

function summarizeResumeSourceApiResponse(response: ResumeSourceApiResponse) {
  return summarizeSourceApiOutcome(response);
}

function summarizePreviewSourceApiResponse(response: PreviewSourceApiResponse) {
  return {
    preview: summarizeSourceApiPreview(response.preview),
  };
}

function summarizeSourceApiOutcome(
  response: ExecuteSourceApiResponse | ResumeSourceApiResponse
) {
  const preview =
    response.outcome.case === "completed" ||
    response.outcome.case === "continued"
      ? response.outcome.value.preview
      : undefined;
  const result =
    response.outcome.case === "completed" ||
    response.outcome.case === "continued"
      ? response.outcome.value.result
      : undefined;
  const continuationToken =
    response.outcome.case === "continued"
      ? response.outcome.value.continuationToken
      : undefined;
  const body =
    result?.body.case === "json"
      ? {
          case: "json",
          value: toJson(ValueSchema, create(ValueSchema, result.body.value)),
        }
      : result?.body.case === "text"
        ? {
            case: "text",
            value: result.body.value,
          }
        : result?.body.case === "binary"
          ? {
              case: "binary",
              value: Array.from(result.body.value),
            }
          : null;

  return {
    continuationToken: continuationToken ?? null,
    preview: preview ? summarizeSourceApiPreview(preview) : null,
    result: result
      ? {
          body,
          contentType: result.contentType,
          headers: result.headers,
          operationName: result.operationName,
          selector: result.selector ?? null,
          source: result.source
            ? {
                ...result.source,
                provider: result.source.provider,
              }
            : null,
          httpStatusCode: result.httpStatusCode,
        }
      : null,
  };
}

function summarizeSourceApiPreview(
  preview: PreviewSourceApiResponse["preview"] | undefined
) {
  return preview
    ? {
        bodyKind: SourceApiBodyKind[preview.bodyKind],
        bodyPaths: preview.bodyPaths,
        headerNames: preview.headerNames,
        host: preview.host ?? null,
        kind: SourceApiOperationKind[preview.kind],
        method: preview.method ?? null,
        operationName: preview.operationName,
        paginationPolicy: SourceApiPaginationPolicy[preview.paginationPolicy],
        source: preview.source
          ? {
              ...preview.source,
              provider: preview.source.provider,
            }
          : null,
        selector: preview.selector ?? null,
        url: preview.url ?? null,
      }
    : null;
}

describe("source api connect service", { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function createTrackedHarness() {
    return createHarness();
  }

  it("describes the source API through the Connect handler", async () => {
    const harness = await createTrackedHarness();
    const request = create(DescribeSourceApiRequestSchema, {
      orgSlug: "acme",
      sourceKey: "github-prod",
    });

    const response = create(
      DescribeSourceApiResponseSchema,
      await harness.handleDescribeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      )
    );

    expect(harness.requestContext.resolveSession).toHaveBeenCalledTimes(1);
    expect({
      describeSourceApiCall:
        harness.dependencies.describeSourceApi.mock.calls[0]?.[0] ?? null,
      loadOrgSourceAccessCall: summarizeLoadOrgSourceAccessCall(
        harness.dependencies.runCliLoadOrgAccessWithSource.mock.calls[0]?.[0]
      ),
      response: summarizeDescribeSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("maps missing source API adapter registration to source unavailable", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.describeSourceApi.mockRejectedValueOnce(
      new SourceApiAdapterNotRegisteredError("github")
    );
    const request = create(DescribeSourceApiRequestSchema, {
      orgSlug: "acme",
      sourceKey: "github-prod",
    });

    const error = await expectConnectError(
      harness.handleDescribeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.FailedPrecondition,
        message: 'No source API adapter is registered for provider "github"',
      }
    );

    expect(error.findDetails(ErrorInfoSchema)[0]).toMatchObject({
      domain: CLI_ERROR_INFO_DOMAIN,
      metadata: {
        problemStage: "resolve_source",
        retryable: "false",
      },
      reason: "SOURCE_API_SOURCE_UNAVAILABLE",
    });
  });

  it("previews source API execution through the Connect handler", async () => {
    const harness = await createTrackedHarness();
    const request = create(PreviewSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        body: {
          case: "fieldPatch",
          value: {
            perPage: 50,
          },
        },
        descriptorVersion: "github-v1",
        headers: [
          {
            name: "accept",
            value: "application/json",
          },
        ],
        methodOverride: "POST",
        operationName: "fetch",
        selector: "/issues",
      },
    });

    const response = create(
      PreviewSourceApiResponseSchema,
      await harness.handlePreviewSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      )
    );

    expect(
      harness.dependencies.executePreparedSourceApi
    ).not.toHaveBeenCalled();
    expect({
      prepareSourceApiDraftCall:
        harness.dependencies.prepareSourceApiDraft.mock.calls[0]?.[0] ?? null,
      loadOrgSourceAccessCall: summarizeLoadOrgSourceAccessCall(
        harness.dependencies.runCliLoadOrgAccessWithSource.mock.calls[0]?.[0]
      ),
      response: summarizePreviewSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("maps descriptor version mismatch to failed precondition", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.prepareSourceApiDraft.mockRejectedValueOnce(
      new SourceApiDescriptorVersionMismatchError({
        expectedDescriptorVersion: "github-v2",
        receivedDescriptorVersion: "github-v1",
      })
    );
    const request = create(PreviewSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        descriptorVersion: "github-v1",
        operationName: "fetch",
        selector: "/issues",
      },
    });

    const error = await expectConnectError(
      harness.handlePreviewSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.FailedPrecondition,
        message:
          'descriptor_version mismatch: expected "github-v2", received "github-v1"',
      }
    );

    expect(error.findDetails(ErrorInfoSchema)[0]).toMatchObject({
      domain: CLI_ERROR_INFO_DOMAIN,
      metadata: {
        problemStage: "source_api_execute",
        retryable: "false",
      },
      reason: "SOURCE_API_EXECUTION_STATE_INVALID",
    });
  });

  it("converts protobuf JSON draft bodies into canonical JsonValue once", async () => {
    const harness = await createTrackedHarness();
    const request = create(PreviewSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        body: {
          case: "jsonBody",
          value: fromJson(ValueSchema, {
            filter: {
              state: "open",
            },
            limit: 25,
          }),
        },
        descriptorVersion: "github-v1",
        operationName: "fetch",
      },
    });

    await harness.handlePreviewSourceApi(
      request,
      createHandlerContext(harness.requestContext)
    );

    expect(
      harness.dependencies.prepareSourceApiDraft.mock.calls[0]?.[0] ?? null
    ).toMatchSnapshot();
  });

  it("executes source API requests through the Connect handler", async () => {
    const harness = await createTrackedHarness();
    const request = create(ExecuteSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        descriptorVersion: "github-v1",
        operationName: "fetch",
        selector: "/issues",
      },
    });

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      )
    );

    expect({
      encodeSourceApiContinuationTokenCalls:
        harness.dependencies.encodeSourceApiContinuationToken.mock.calls.length,
      executePreparedSourceApiCall:
        harness.dependencies.executePreparedSourceApi.mock.calls[0]?.[0] ??
        null,
      loadOrgSourceAccessCall: summarizeLoadOrgSourceAccessCall(
        harness.dependencies.runCliLoadOrgAccessWithSource.mock.calls[0]?.[0]
      ),
      response: summarizeExecuteSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("preserves JSON source API response bodies through the Connect handler", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.executePreparedSourceApi.mockResolvedValueOnce({
      ...executionResponse,
      body: {
        kind: "json",
        value: {
          id: 1,
          name: "onequery",
          private: false,
        },
      },
      contentType: "application/json",
    });

    const request = create(ExecuteSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        descriptorVersion: "github-v1",
        operationName: "fetch",
      },
    });

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      )
    );

    expect(summarizeExecuteSourceApiResponse(response)).toMatchSnapshot();
  });

  it("binds continuation tokens to execution state during resume", async () => {
    const harness = await createTrackedHarness();
    const seeded = await seedResumableSourceApiAction(
      harness.db,
      "req_cli_resume_seed"
    );
    harness.dependencies.decodeSourceApiContinuationToken.mockReturnValueOnce({
      ...decodedContinuationToken,
      actionId: seeded.actionId,
      resumeFromEventId: seeded.resumeFromEventId,
    });
    harness.dependencies.executePreparedSourceApi.mockResolvedValueOnce({
      ...executionResponse,
      nextContinuationState: {
        cursor: "page_3",
      },
    });
    const request = createResumeExecuteSourceApiRequest();

    const response = create(
      ResumeSourceApiResponseSchema,
      await harness.handleResumeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      )
    );

    const encodeContinuationTokenCall =
      harness.dependencies.encodeSourceApiContinuationToken.mock
        .calls[0]?.[0] ?? null;

    expect({
      decodeSourceApiContinuationTokenCall: harness.dependencies
        .decodeSourceApiContinuationToken.mock.calls[0]?.[0]
        ? {
            ...harness.dependencies.decodeSourceApiContinuationToken.mock
              .calls[0][0],
            now: "<date>",
          }
        : null,
      encodeSourceApiContinuationTokenCall: encodeContinuationTokenCall
        ? {
            ...encodeContinuationTokenCall,
            actionId: "<action_id>",
            now: encodeContinuationTokenCall.now ?? null,
            resumeFromEventId: "<event_id>",
          }
        : null,
      executePreparedSourceApiCall:
        harness.dependencies.executePreparedSourceApi.mock.calls[0]?.[0] ??
        null,
      response: summarizeResumeSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("rejects continuation token resume for operations without continuation support", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.decodeSourceApiContinuationToken.mockReturnValueOnce({
      ...decodedContinuationToken,
      prepared: {
        ...decodedContinuationToken.prepared,
        paginationPolicy: "none",
      },
    });
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleResumeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.InvalidArgument,
        message: 'operation "fetch" does not support continuation_token resume',
      }
    );

    expect(
      harness.dependencies.executePreparedSourceApi
    ).not.toHaveBeenCalled();
  });

  it("maps malformed continuation tokens to invalid arguments", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.decodeSourceApiContinuationToken.mockImplementation(
      () => {
        throw new SourceApiInvalidRequestError(
          "Invalid source API continuation token"
        );
      }
    );
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleResumeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.InvalidArgument,
        message: "Invalid source API continuation token",
      }
    );
  });

  it("maps expired continuation tokens to failed precondition", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.decodeSourceApiContinuationToken.mockImplementation(
      () => {
        throw new SourceApiExpiredError(
          "Source API continuation token expired"
        );
      }
    );
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleResumeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.FailedPrecondition,
        message: "Source API continuation token expired",
      }
    );
  });

  it("maps descriptor drift to failed precondition during resume", async () => {
    const harness = await createTrackedHarness();
    const seeded = await seedResumableSourceApiAction(
      harness.db,
      "req_cli_resume_drift_seed"
    );
    harness.dependencies.decodeSourceApiContinuationToken.mockReturnValueOnce({
      ...decodedContinuationToken,
      actionId: seeded.actionId,
      resumeFromEventId: seeded.resumeFromEventId,
    });
    harness.dependencies.describeSourceApi.mockResolvedValueOnce({
      ...descriptor,
      descriptorVersion: "github-v2",
    });
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleResumeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.FailedPrecondition,
        message: "descriptor version no longer matches",
      }
    );
  });

  it("maps source api authorization failures to permission denied", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.executePreparedSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "authorize",
        new SourceApiPermissionDeniedError({
          operation: "fetch",
          userId: "user-1",
        })
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        descriptorVersion: "github-v1",
        operationName: "fetch",
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.PermissionDenied,
        message:
          'Actor "user-1" is not allowed to execute source API operation "fetch"',
      }
    );
  });

  it("maps adapter execution failures to connect errors", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.executePreparedSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "execute",
        new Error("GitHub upstream request failed")
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        descriptorVersion: "github-v1",
        operationName: "fetch",
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.Internal,
        message: "GitHub upstream request failed",
      }
    );
  });

  it("maps adapter execution timeouts to retryable deadline exceeded errors", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.executePreparedSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "execute",
        new SourceApiTimeoutError("GitHub upstream request timed out")
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      target: {
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
      draft: {
        descriptorVersion: "github-v1",
        operationName: "fetch",
      },
    });

    const error = await expectConnectError(
      harness.handleExecuteSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.DeadlineExceeded,
        message: "GitHub upstream request timed out",
      }
    );
    const errorInfoDetails = error.findDetails(ErrorInfoSchema);
    const actionRow = await harness.db.query.sourceApiActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, authorizedOrg.org.id),
    });

    expect(errorInfoDetails).toHaveLength(1);
    expect(errorInfoDetails[0]).toMatchObject({
      domain: CLI_ERROR_INFO_DOMAIN,
      metadata: {
        problemStage: "source_api_execute",
        retryable: "true",
      },
      reason: "SOURCE_API_EXECUTION_TIMED_OUT",
    });
    expect(actionRow).toMatchObject({
      failureCode: "request_timed_out",
      outcome: "failed",
      phase: "completed",
    });
  });

  it("returns not logged in before validating source api execute input", async () => {
    const harness = await createTrackedHarness();
    harness.requestContext.resolveSession.mockResolvedValueOnce(
      Result.err(
        createCliServiceFailure({
          detail: "no authenticated session was found",
          key: "NOT_LOGGED_IN",
        })
      )
    );
    const request = create(ExecuteSourceApiRequestSchema);

    await expectConnectError(
      harness.handleExecuteSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.Unauthenticated,
        message: "no authenticated session was found",
      }
    );

    expect(harness.dependencies.prepareSourceApiDraft).not.toHaveBeenCalled();
  });

  it("returns not logged in before decoding continuation tokens", async () => {
    const harness = await createTrackedHarness();
    harness.requestContext.resolveSession.mockResolvedValueOnce(
      Result.err(
        createCliServiceFailure({
          detail: "no authenticated session was found",
          key: "NOT_LOGGED_IN",
        })
      )
    );
    harness.dependencies.decodeSourceApiContinuationToken.mockImplementation(
      () => {
        throw new SourceApiInvalidRequestError(
          "Invalid source API continuation token"
        );
      }
    );
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleResumeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.Unauthenticated,
        message: "no authenticated session was found",
      }
    );

    expect(
      harness.dependencies.decodeSourceApiContinuationToken
    ).not.toHaveBeenCalled();
  });

  it("resolves the requested resume source before decoding continuation tokens", async () => {
    const harness = await createTrackedHarness();
    harness.dependencies.runCliLoadOrgAccessWithSource.mockResolvedValueOnce({
      access: {
        kind: "found",
        org: {
          id: authorizedOrg.org.id,
          name: "Acme",
          slug: authorizedOrg.org.slug,
        },
        rawMembershipRole: "owner",
      },
      source: {
        kind: "not_found",
      },
    });
    harness.dependencies.decodeSourceApiContinuationToken.mockImplementation(
      () => {
        throw new SourceApiInvalidRequestError(
          "Invalid source API continuation token"
        );
      }
    );
    const request = createResumeExecuteSourceApiRequest({
      sourceKey: "missing-source",
    });

    await expectConnectError(
      harness.handleResumeSourceApi(
        request,
        createHandlerContext(harness.requestContext)
      ),
      {
        code: Code.NotFound,
        message: 'no source named "missing-source" exists in org "acme"',
      }
    );

    expect(
      harness.dependencies.decodeSourceApiContinuationToken
    ).not.toHaveBeenCalled();
  });
});
