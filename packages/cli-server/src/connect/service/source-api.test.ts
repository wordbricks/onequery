import { create, fromJson, isMessage, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidRequestError,
  SourceApiPermissionDeniedError,
} from "@onequery/server/source-api";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CliSourceApiBodyKind,
  CliSourceApiExecuteMode,
  CliSourceApiOperationKind,
  CliSourceApiPaginationPolicy,
  DescribeSourceApiRequestSchema,
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiRequestSchema,
  ExecuteSourceApiResponseSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import type {
  DescribeSourceApiResponse,
  ExecuteSourceApiResponse,
} from "../gen/onequery/cli/v1/source_api_pb";
import { CliSourceProvider } from "../gen/onequery/cli/v1/source_pb";
import {
  createHandleDescribeSourceApi,
  createHandleExecuteSourceApi,
} from "./source-api";

function summarizeCliSourceProvider(provider: CliSourceProvider): string {
  return CliSourceProvider[provider].toLowerCase();
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
    key: "github-prod",
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
  provider: "github",
  selector: "/issues",
  sourceKey: "github-prod",
  url: "https://api.github.com/issues",
} as const;

const decodedContinuationToken = {
  expiresAt: "2026-04-10T00:05:00.000Z",
  issuedAt: "2026-04-10T00:00:00.000Z",
  organizationSlug: "acme",
  prepared: {
    ...prepared,
    paginationPolicy: "continuation_token",
  },
  state: {
    cursor: "page_2",
  },
  version: 1 as const,
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
    key: "github-prod",
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
    requireCliConnectRequestContext: vi.fn().mockReturnValue(requestContext),
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
      kind: CliSourceApiOperationKind[operation.kind],
      paginationPolicy:
        CliSourceApiPaginationPolicy[operation.paginationPolicy],
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
          bodyKind: CliSourceApiBodyKind[preview.bodyKind],
          bodyPaths: preview.bodyPaths,
          headerNames: preview.headerNames,
          host: preview.host ?? null,
          kind: CliSourceApiOperationKind[preview.kind],
          method: preview.method ?? null,
          operation: preview.operation,
          paginationPolicy:
            CliSourceApiPaginationPolicy[preview.paginationPolicy],
          provider: summarizeCliSourceProvider(preview.provider),
          selector: preview.selector ?? null,
          sourceKey: preview.sourceKey,
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
      await harness.handleDescribeSourceApi(request, {
        values: new Map(),
      } as never)
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
          draft: {
            body: {
              case: "textBody",
              value: "body text",
            },
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
            orgSlug: "acme",
            selector: "/issues",
            sourceKey: "github-prod",
          },
          mode: CliSourceApiExecuteMode.PREVIEW_ONLY,
        },
      },
    });

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
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
            operation: "fetch",
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          mode: CliSourceApiExecuteMode.PREVIEW_ONLY,
        },
      },
    });

    await harness.handleExecuteSourceApi(request, {
      values: new Map(),
    } as never);

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
          draft: {
            operation: "fetch",
            orgSlug: "acme",
            selector: "/issues",
            sourceKey: "github-prod",
          },
          mode: CliSourceApiExecuteMode.EXECUTE,
        },
      },
    });

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
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
          draft: {
            operation: "fetch",
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          mode: CliSourceApiExecuteMode.EXECUTE,
        },
      },
    });

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
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
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "resume",
        value: {
          continuationToken: "continuation_1",
        },
      },
    });

    const response = create(
      ExecuteSourceApiResponseSchema,
      await harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
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
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "resume",
        value: {
          continuationToken: "continuation_1",
        },
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never),
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
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "resume",
        value: {
          continuationToken: "continuation_1",
        },
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never),
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
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "resume",
        value: {
          continuationToken: "continuation_1",
        },
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never),
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
    const request = create(ExecuteSourceApiRequestSchema, {
      input: {
        case: "resume",
        value: {
          continuationToken: "continuation_1",
        },
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never),
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
          draft: {
            operation: "fetch",
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          mode: CliSourceApiExecuteMode.EXECUTE,
        },
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never),
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
          draft: {
            operation: "fetch",
            orgSlug: "acme",
            sourceKey: "github-prod",
          },
          mode: CliSourceApiExecuteMode.EXECUTE,
        },
      },
    });

    await expectConnectError(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never),
      {
        code: Code.Internal,
        message: "GitHub upstream request failed",
      }
    );
  });
});
