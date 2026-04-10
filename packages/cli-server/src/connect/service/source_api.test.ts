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
  DescribeSourceApiRequestSchema,
  ExecutePreparedSourceApiRequestSchema,
  PrepareSourceApiRequestSchema,
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
  nextPageToken: "page_2",
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
    decodePreparedSourceApiToken: vi.fn().mockReturnValue(decodedPreparedToken),
    describeSourceApi: vi.fn().mockResolvedValue(descriptor),
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
    expect(harness.requestContext.requireAuthorizedOrg).toHaveBeenCalledWith({
      action: "source_api.describe",
      orgSlug: "acme",
      session,
    });
    expect(harness.dependencies.describeSourceApi).toHaveBeenCalledWith({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: "org-1",
        organizationSlug: "acme",
        requestId: "req_cli_123",
        userId: "user-1",
      },
      source: preparedSource,
    });
    expect(response).toMatchObject({
      defaultPathOperation: "fetch",
      descriptorVersion: "github-v1",
      notes: ["Uses the GitHub REST API."],
      source: {
        displayName: "GitHub Prod",
        key: "github-prod",
        provider: "github",
      },
    });
    expect(response.operations?.map((operation) => operation.name)).toEqual([
      "fetch",
    ]);
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

    expect(harness.requestContext.requireAuthorizedOrg).toHaveBeenCalledWith({
      action: "source_api.execute",
      orgSlug: "acme",
      session,
    });
    expect(harness.dependencies.prepareSourceApiDraft).toHaveBeenCalledWith({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: "org-1",
        organizationSlug: "acme",
        requestId: "req_cli_123",
        userId: "user-1",
      },
      descriptor,
      draft: {
        body: {
          kind: "text",
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
        selector: "/issues",
      },
      source: preparedSource,
    });
    expect(
      harness.dependencies.createPreparedSourceApiPreview
    ).toHaveBeenCalledWith(prepared);
    expect(
      harness.dependencies.encodePreparedSourceApiToken
    ).toHaveBeenCalledWith({
      organizationSlug: "acme",
      prepared,
      secret: "master-key",
    });
    expect(response).toMatchObject({
      preparedToken: "prepared_token_1",
      preview: {
        bodyKind: CliSourceApiBodyKind.TEXT,
        kind: CliSourceApiOperationKind.HTTP_REQUEST,
        operation: "fetch",
        provider: "github",
        sourceKey: "github-prod",
      },
    });
    expect(
      (response.preview as Record<string, unknown>).requestFingerprint
    ).toBeUndefined();
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

    expect(harness.dependencies.prepareSourceApiDraft).toHaveBeenCalledWith({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: "org-1",
        organizationSlug: "acme",
        requestId: "req_cli_123",
        userId: "user-1",
      },
      descriptor,
      draft: {
        body: {
          kind: "json",
          value: {
            filter: {
              state: "open",
            },
            limit: 25,
          },
        },
        fieldPatch: undefined,
        headers: [],
        methodOverride: undefined,
        operation: "fetch",
        selector: undefined,
      },
      source: preparedSource,
    });
  });

  it("executes prepared source API requests through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(ExecutePreparedSourceApiRequestSchema, {
      preparedToken: "prepared_token_1",
    });

    const response = await harness.handleExecutePreparedSourceApi(request, {
      values: new Map(),
    } as never);

    expect(
      harness.dependencies.decodePreparedSourceApiToken
    ).toHaveBeenCalledWith({
      secret: "master-key",
      token: "prepared_token_1",
    });
    expect(harness.requestContext.requireAuthorizedOrg).toHaveBeenCalledWith({
      action: "source_api.execute",
      orgSlug: "acme",
      session,
    });
    expect(harness.dependencies.executePreparedSourceApi).toHaveBeenCalledWith({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: "org-1",
        organizationSlug: "acme",
        requestId: "req_cli_123",
        userId: "user-1",
      },
      prepared,
      source: preparedSource,
    });
    expect(response).toMatchObject({
      contentType: "text/plain",
      nextPageToken: "page_2",
      operation: "fetch",
      selector: "/issues",
      status: 200,
    });
    expect((response as Record<string, unknown>).requestId).toBeUndefined();
    expect(response.body).toEqual({
      case: "text",
      value: "ok",
    });
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
    expect(responseBody?.case).toBe("json");
    if (responseBody?.case !== "json") {
      throw new Error("expected JSON response body");
    }
    expect(
      toJson(ValueSchema, create(ValueSchema, responseBody.value))
    ).toEqual({
      id: 1,
      name: "onequery",
      private: false,
    });
  });

  it("rejects page_token continuation until task 4 wires provider pagination", async () => {
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
        code: Code.Unimplemented,
        message: "page_token continuation is not implemented yet",
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
        code: Code.Unknown,
        message: "GitHub upstream request failed",
      }
    );
  });
});
