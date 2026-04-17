import { create, fromJson, isMessage, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import {
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidRequestError,
  SourceApiPermissionDeniedError,
} from "@onequery/server/source-api";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cliConnectRequestContextKey } from "../context";
import { createCliConnectProblem } from "../error";
import {
  SourceApiBodyKind,
  SourceApiExecuteMode,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  DescribeSourceApiRequestSchema,
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiRequestSchema,
  ExecuteSourceApiResponseSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import type {
  DescribeSourceApiResponse,
  ExecuteSourceApiResponse,
} from "../gen/onequery/cli/v1/source_api_pb";
import { SourceProvider } from "../gen/onequery/cli/v1/source_pb";
import {
  createHandleDescribeSourceApi,
  createHandleExecuteSourceApi,
} from "./source-api";

function summarizeCliSourceProvider(provider: SourceProvider): string {
  return SourceProvider[provider].toLowerCase();
}

expect.addSnapshotSerializer({
  serialize(value, config, indentation, depth, refs, printer) {
    const { $typeName: _ignored, ...rest } = value;
    return printer(rest, config, indentation, depth, refs);
  },
  test: isMessage,
});

const session = {
  user: {
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

const honoContext = {
  var: {
    runtime: {
      crypto: {
        masterEncryptionKey: "master-key",
      },
    },
    storage: {
      db: { kind: "db" },
    },
  },
} as const;

const loadedSource = {
  kind: "loaded",
  source: {
    displayName: "GitHub Prod",
    id: "source-1",
    provider: "github",
    sourceKey: "github-prod",
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
  expiresAt: "2026-04-10T00:05:00.000Z",
  issuedAt: "2026-04-10T00:00:00.000Z",
  prepared: {
    ...prepared,
    paginationPolicy: "continuation_token",
  },
  state: {
    cursor: "page_2",
  },
  version: 2 as const,
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

function createHarness() {
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
        path: "/connectrpc/onequery.cli.v1.CliService/ExecuteSourceApi",
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
    runCliLoadSourceEffect: vi.fn().mockResolvedValue(loadedSource),
    toCliErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    ),
  };

  return {
    dependencies,
    handleDescribeSourceApi: createHandleDescribeSourceApi(dependencies),
    handleExecuteSourceApi: createHandleExecuteSourceApi(dependencies),
    requestContext,
  };
}

function createHandlerContext(
  requestContext: ReturnType<typeof createHarness>["requestContext"]
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
  return create(ExecuteSourceApiRequestSchema, {
    input: {
      case: "resume",
      value: {
        continuationToken: input.continuationToken ?? "continuation_1",
        target: {
          orgSlug: input.orgSlug ?? "acme",
          sourceKey: input.sourceKey ?? "github-prod",
        },
      },
    },
  });
}

async function expectConnectError(
  promise: Promise<unknown> | unknown,
  input: {
    code: Code;
    message: string;
  }
) {
  try {
    await Promise.resolve(promise);
    throw new Error("expected ConnectError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(input.code);
    expect((error as ConnectError).message).toContain(input.message);
  }
}

function summarizeDescribeSourceApiResponse(
  response: DescribeSourceApiResponse
) {
  return {
    defaultPathOperation: response.defaultPathOperation ?? null,
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
          provider: summarizeCliSourceProvider(response.source.provider),
        }
      : null,
  };
}

function summarizeExecuteSourceApiResponse(response: ExecuteSourceApiResponse) {
  const preview = response.preview;
  const result = response.result;
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
    continuationToken: response.continuationToken ?? null,
    preview: preview
      ? {
          bodyKind: SourceApiBodyKind[preview.bodyKind],
          bodyPaths: preview.bodyPaths,
          headerNames: preview.headerNames,
          host: preview.host ?? null,
          kind: SourceApiOperationKind[preview.kind],
          method: preview.method ?? null,
          operation: preview.operation,
          paginationPolicy: SourceApiPaginationPolicy[preview.paginationPolicy],
          source: preview.source
            ? {
                ...preview.source,
                provider: summarizeCliSourceProvider(preview.source.provider),
              }
            : null,
          selector: preview.selector ?? null,
          url: preview.url ?? null,
        }
      : null,
    result: result
      ? {
          body,
          contentType: result.contentType,
          headers: result.headers,
          operation: result.operation,
          selector: result.selector ?? null,
          source: result.source
            ? {
                ...result.source,
                provider: summarizeCliSourceProvider(result.source.provider),
              }
            : null,
          status: result.status,
        }
      : null,
  };
}

describe("source api connect service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("describes the source API through the Connect handler", async () => {
    const harness = createHarness();
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
      requireAuthorizedOrgCall:
        harness.requestContext.resolveAuthorizedOrg.mock.calls[0]?.[0] ?? null,
      response: summarizeDescribeSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("previews source API execution through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "start",
        value: {
          target: {
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          draft: {
            body: {
              case: "textBody",
              value: "body text",
            },
            descriptorVersion: "github-v1",
            fieldPatch: {
              perPage: 50,
            },
            headers: [
              {
                name: "accept",
                value: "application/json",
              },
            ],
            methodOverride: "POST",
            operation: "fetch",
            selector: "/issues",
          },
          mode: SourceApiExecuteMode.PREVIEW_ONLY,
        },
      },
    });

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(
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
      requireAuthorizedOrgCall:
        harness.requestContext.resolveAuthorizedOrg.mock.calls[0]?.[0] ?? null,
      response: summarizeExecuteSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("converts protobuf JSON draft bodies into canonical JsonValue once", async () => {
    const harness = createHarness();
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "start",
        value: {
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
            operation: "fetch",
          },
          mode: SourceApiExecuteMode.PREVIEW_ONLY,
        },
      },
    });

    await harness.handleExecuteSourceApi(
      request,
      createHandlerContext(harness.requestContext)
    );

    expect(
      harness.dependencies.prepareSourceApiDraft.mock.calls[0]?.[0] ?? null
    ).toMatchSnapshot();
  });

  it("executes source API requests through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "start",
        value: {
          target: {
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          draft: {
            descriptorVersion: "github-v1",
            operation: "fetch",
            selector: "/issues",
          },
          mode: SourceApiExecuteMode.EXECUTE,
        },
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
      requireAuthorizedOrgCall:
        harness.requestContext.resolveAuthorizedOrg.mock.calls[0]?.[0] ?? null,
      response: summarizeExecuteSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("preserves JSON source API response bodies through the Connect handler", async () => {
    const harness = createHarness();
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
      input: {
        case: "start",
        value: {
          target: {
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          draft: {
            descriptorVersion: "github-v1",
            operation: "fetch",
          },
          mode: SourceApiExecuteMode.EXECUTE,
        },
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
    const harness = createHarness();
    harness.dependencies.executePreparedSourceApi.mockResolvedValueOnce({
      ...executionResponse,
      nextContinuationState: {
        cursor: "page_3",
      },
    });
    const request = createResumeExecuteSourceApiRequest();

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(
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
            now: encodeContinuationTokenCall.now ?? null,
          }
        : null,
      executePreparedSourceApiCall:
        harness.dependencies.executePreparedSourceApi.mock.calls[0]?.[0] ??
        null,
      response: summarizeExecuteSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("rejects continuation token resume for operations without continuation support", async () => {
    const harness = createHarness();
    harness.dependencies.decodeSourceApiContinuationToken.mockReturnValueOnce({
      ...decodedContinuationToken,
      prepared: {
        ...decodedContinuationToken.prepared,
        paginationPolicy: "none",
      },
    });
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleExecuteSourceApi(
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
    const harness = createHarness();
    harness.dependencies.decodeSourceApiContinuationToken.mockImplementation(
      () => {
        throw new SourceApiInvalidRequestError(
          "Invalid source API continuation token"
        );
      }
    );
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleExecuteSourceApi(
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
    const harness = createHarness();
    harness.dependencies.decodeSourceApiContinuationToken.mockImplementation(
      () => {
        throw new SourceApiExpiredError(
          "Source API continuation token expired"
        );
      }
    );
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleExecuteSourceApi(
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
    const harness = createHarness();
    harness.dependencies.describeSourceApi.mockResolvedValueOnce({
      ...descriptor,
      descriptorVersion: "github-v2",
    });
    const request = createResumeExecuteSourceApiRequest();

    await expectConnectError(
      harness.handleExecuteSourceApi(
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
    const harness = createHarness();
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
      input: {
        case: "start",
        value: {
          target: {
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          draft: {
            descriptorVersion: "github-v1",
            operation: "fetch",
          },
          mode: SourceApiExecuteMode.EXECUTE,
        },
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
    const harness = createHarness();
    harness.dependencies.executePreparedSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "execute",
        new Error("GitHub upstream request failed")
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "start",
        value: {
          target: {
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          draft: {
            descriptorVersion: "github-v1",
            operation: "fetch",
          },
          mode: SourceApiExecuteMode.EXECUTE,
        },
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

  it("returns not logged in before validating source api execute input", async () => {
    const harness = createHarness();
    harness.requestContext.resolveSession.mockResolvedValueOnce(
      Result.err(
        createCliConnectProblem({
          detail: "no authenticated session was found",
          key: "NOT_LOGGED_IN",
        })
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "start",
        value: {
          mode: SourceApiExecuteMode.EXECUTE,
        },
      },
    });

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
    const harness = createHarness();
    harness.requestContext.resolveSession.mockResolvedValueOnce(
      Result.err(
        createCliConnectProblem({
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
      harness.handleExecuteSourceApi(
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
    const harness = createHarness();
    harness.dependencies.runCliLoadSourceEffect.mockResolvedValueOnce({
      kind: "not_found",
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
      harness.handleExecuteSourceApi(
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
