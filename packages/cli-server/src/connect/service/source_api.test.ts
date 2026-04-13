import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  SourceApiExecutionStageError,
  SourceApiExpiredError,
  SourceApiInvalidRequestError,
  SourceApiPermissionDeniedError,
} from "@onequery/server/source-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CliSourceApiBodyKind,
  CliSourceApiOperationKind,
  CliSourceApiPaginationPolicy,
  DescribeSourceApiRequestSchema,
  ExecutePreparedSourceApiRequestSchema,
  PrepareSourceApiRequestSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import type {
  DescribeSourceApiResponse,
  ExecutePreparedSourceApiResponse,
  PrepareSourceApiResponse,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  createHandleDescribeSourceApi,
  createHandleExecutePreparedSourceApi,
  createHandlePrepareSourceApi,
} from "./source_api";

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

const preparedPreview = {
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

const decodedPreparedToken = {
  expiresAt: "2026-04-10T00:05:00.000Z",
  issuedAt: "2026-04-10T00:00:00.000Z",
  organizationSlug: "acme",
  prepared,
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
    requireAuthorizedOrg: vi.fn().mockResolvedValue(authorizedOrg),
    requireSession: vi.fn().mockResolvedValue(session),
  };
  const dependencies = {
    buildCliRequestLogDetails: vi.fn(
      (_: unknown, details?: Record<string, unknown>) => ({
        method: "POST",
        path: "/connectrpc/onequery.cli.v1.CliService/PrepareSourceApi",
        requestId: "req_cli_123",
        ...(details ?? {}),
      })
    ),
    createPreparedSourceApiPreview: vi.fn().mockReturnValue(preparedPreview),
    decodeOpaquePageToken: vi.fn().mockReturnValue({
      expiresAt: "2026-04-10T00:04:00.000Z",
      issuedAt: "2026-04-10T00:01:00.000Z",
      operation: "fetch",
      preparedBinding: "prepared_binding_123",
      sourceKey: "github-prod",
      state: {
        cursor: "page_2",
      },
    }),
    decodePreparedSourceApiToken: vi.fn().mockReturnValue(decodedPreparedToken),
    describeSourceApi: vi.fn().mockResolvedValue(descriptor),
    encodeOpaquePageToken: vi.fn().mockReturnValue("page_2"),
    encodePreparedSourceApiToken: vi.fn().mockReturnValue("prepared_token_1"),
    executePreparedSourceApi: vi.fn().mockResolvedValue(executionResponse),
    getCliLogLevelForStatus: vi.fn((): "info" => "info"),
    logCliEvent: vi.fn(),
    prepareDataSourceCredentials: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        credentials: preparedSource.credentials,
      },
    }),
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
    handleExecutePreparedSourceApi:
      createHandleExecutePreparedSourceApi(dependencies),
    handlePrepareSourceApi: createHandlePrepareSourceApi(dependencies),
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
    source: response.source ?? null,
  };
}

function summarizePrepareSourceApiResponse(response: PrepareSourceApiResponse) {
  const preview = response.preview;
  return {
    preparedToken: response.preparedToken,
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
          provider: preview.provider,
          selector: preview.selector ?? null,
          sourceKey: preview.sourceKey,
          url: preview.url ?? null,
        }
      : null,
  };
}

function summarizeExecutePreparedSourceApiResponse(
  response: ExecutePreparedSourceApiResponse
) {
  const body =
    response.body.case === "json"
      ? {
          case: "json",
          value: toJson(ValueSchema, create(ValueSchema, response.body.value)),
        }
      : response.body.case === "text"
        ? {
            case: "text",
            value: response.body.value,
          }
        : response.body.case === "binary"
          ? {
              case: "binary",
              value: Array.from(response.body.value),
            }
          : null;

  return {
    body,
    contentType: response.contentType,
    headers: response.headers,
    nextPageToken: response.nextPageToken ?? null,
    operation: response.operation,
    selector: response.selector ?? null,
    source: response.source ?? null,
    status: response.status,
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

    const response = await harness.handleDescribeSourceApi(request, {
      values: new Map(),
    } as never);

    expect(harness.requestContext.requireSession).toHaveBeenCalledTimes(1);
    expect({
      describeSourceApiCall:
        harness.dependencies.describeSourceApi.mock.calls[0]?.[0] ?? null,
      requireAuthorizedOrgCall:
        harness.requestContext.requireAuthorizedOrg.mock.calls[0]?.[0] ?? null,
      response: summarizeDescribeSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("prepares the source API request through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(PrepareSourceApiRequestSchema, {
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
    });

    const response = await harness.handlePrepareSourceApi(request, {
      values: new Map(),
    } as never);

    expect({
      createPreparedSourceApiPreviewCall:
        harness.dependencies.createPreparedSourceApiPreview.mock
          .calls[0]?.[0] ?? null,
      encodePreparedSourceApiTokenCall:
        harness.dependencies.encodePreparedSourceApiToken.mock.calls[0]?.[0] ??
        null,
      prepareSourceApiDraftCall:
        harness.dependencies.prepareSourceApiDraft.mock.calls[0]?.[0] ?? null,
      requireAuthorizedOrgCall:
        harness.requestContext.requireAuthorizedOrg.mock.calls[0]?.[0] ?? null,
      response: summarizePrepareSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("converts protobuf JSON draft bodies into canonical JsonValue once", async () => {
    const harness = createHarness();
    const request = create(PrepareSourceApiRequestSchema, {
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
    });

    await harness.handlePrepareSourceApi(request, {
      values: new Map(),
    } as never);

    expect(
      harness.dependencies.prepareSourceApiDraft.mock.calls[0]?.[0] ?? null
    ).toMatchSnapshot();
  });

  it("executes prepared source API requests through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    const response = await harness.handleExecutePreparedSourceApi(request, {
      values: new Map(),
    } as never);

    expect({
      decodePreparedSourceApiTokenCall:
        harness.dependencies.decodePreparedSourceApiToken.mock.calls[0]?.[0] ??
        null,
      encodeOpaquePageTokenCalls:
        harness.dependencies.encodeOpaquePageToken.mock.calls.length,
      executePreparedSourceApiCall:
        harness.dependencies.executePreparedSourceApi.mock.calls[0]?.[0] ??
        null,
      requireAuthorizedOrgCall:
        harness.requestContext.requireAuthorizedOrg.mock.calls[0]?.[0] ?? null,
      requestId: (response as Record<string, unknown>).requestId,
      response: summarizeExecutePreparedSourceApiResponse(response),
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

    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    const response = await harness.handleExecutePreparedSourceApi(request, {
      values: new Map(),
    } as never);

    const responseBody = response.body;
    expect(responseBody.case).toBe("json");
    if (responseBody.case !== "json") {
      throw new Error("expected JSON response body");
    }
    expect(
      summarizeExecutePreparedSourceApiResponse(response)
    ).toMatchSnapshot();
  });

  it("binds opaque page tokens to prepared execution state during execute", async () => {
    const harness = createHarness();
    harness.dependencies.decodePreparedSourceApiToken.mockReturnValueOnce({
      ...decodedPreparedToken,
      prepared: {
        ...prepared,
        paginationPolicy: "opaque_token",
      },
    });
    harness.dependencies.executePreparedSourceApi.mockResolvedValueOnce({
      ...executionResponse,
      nextContinuationState: {
        cursor: "page_3",
      },
    });
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      pageToken: "page_1",
      preparedToken: "prepared_token_1",
    });

    const response = await harness.handleExecutePreparedSourceApi(request, {
      values: new Map(),
    } as never);

    const decodeOpaquePageTokenCall =
      harness.dependencies.decodeOpaquePageToken.mock.calls[0]?.[0] ?? null;
    const encodeOpaquePageTokenCall =
      harness.dependencies.encodeOpaquePageToken.mock.calls[0]?.[0] ?? null;

    expect({
      decodeOpaquePageTokenCall: decodeOpaquePageTokenCall
        ? {
            ...decodeOpaquePageTokenCall,
            now: "<date>",
          }
        : null,
      encodeOpaquePageTokenCall: encodeOpaquePageTokenCall
        ? {
            ...encodeOpaquePageTokenCall,
            payload: {
              ...encodeOpaquePageTokenCall.payload,
              expiresAt: "<expiresAt>",
              issuedAt: "<issuedAt>",
            },
          }
        : null,
      executePreparedSourceApiCall:
        harness.dependencies.executePreparedSourceApi.mock.calls[0]?.[0] ??
        null,
      response: summarizeExecutePreparedSourceApiResponse(response),
    }).toMatchSnapshot();
  });

  it("rejects page_token continuation for operations without pagination support", async () => {
    const harness = createHarness();
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      pageToken: "page_1",
      preparedToken: "prepared_token_1",
    });

    await expectConnectError(
      harness.handleExecutePreparedSourceApi(request, {
        values: new Map(),
      } as never),
      {
        code: Code.InvalidArgument,
        message: 'operation "fetch" does not support page_token continuation',
      }
    );

    expect(
      harness.dependencies.executePreparedSourceApi
    ).not.toHaveBeenCalled();
  });

  it("maps malformed prepared tokens to invalid arguments", async () => {
    const harness = createHarness();
    harness.dependencies.decodePreparedSourceApiToken.mockImplementation(() => {
      throw new SourceApiInvalidRequestError("Invalid prepared token");
    });
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    await expectConnectError(
      harness.handleExecutePreparedSourceApi(request, {
        values: new Map(),
      } as never),
      {
        code: Code.InvalidArgument,
        message: "Invalid prepared token",
      }
    );
  });

  it("maps expired prepared tokens to failed precondition", async () => {
    const harness = createHarness();
    harness.dependencies.decodePreparedSourceApiToken.mockImplementation(() => {
      throw new SourceApiExpiredError("Prepared source API token expired");
    });
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    await expectConnectError(
      harness.handleExecutePreparedSourceApi(request, {
        values: new Map(),
      } as never),
      {
        code: Code.FailedPrecondition,
        message: "Prepared source API token expired",
      }
    );
  });

  it("maps unavailable source credentials to failed precondition", async () => {
    const harness = createHarness();
    harness.dependencies.prepareDataSourceCredentials.mockResolvedValueOnce({
      error: "source credentials are no longer available",
      ok: false,
    });
    const request = create(DescribeSourceApiRequestSchema, {
      orgSlug: "acme",
      sourceKey: "github-prod",
    });

    await expectConnectError(
      harness.handleDescribeSourceApi(request, {
        values: new Map(),
      } as never),
      {
        code: Code.FailedPrecondition,
        message: "source credentials are no longer available",
      }
    );
  });

  it("maps descriptor drift to failed precondition", async () => {
    const harness = createHarness();
    harness.dependencies.describeSourceApi.mockResolvedValueOnce({
      ...descriptor,
      descriptorVersion: "github-v2",
    });
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    await expectConnectError(
      harness.handleExecutePreparedSourceApi(request, {
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
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    await expectConnectError(
      harness.handleExecutePreparedSourceApi(request, {
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
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    await expectConnectError(
      harness.handleExecutePreparedSourceApi(request, {
        values: new Map(),
      } as never),
      {
        code: Code.Internal,
        message: "GitHub upstream request failed",
      }
    );
  });
});
