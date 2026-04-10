import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  SourceApiAdapterNotRegisteredError,
  SourceApiDescriptorVersionMismatchError,
  SourceApiExecutionStageError,
  SourceApiInvalidRequestError,
  SourceApiPermissionDeniedError,
  SourceApiUnsupportedOperationError,
} from "@onequery/server/source-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CliSourceApiBodyKind,
  CliSourceApiOperationKind,
  DescribeSourceApiRequestSchema,
  ExecuteSourceApiRequestSchema,
  NormalizeSourceApiRequestSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  createHandleDescribeSourceApi,
  createHandleExecuteSourceApi,
  createHandleNormalizeSourceApi,
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

const postgresLoadedSource = {
  ...loadedSource,
  source: {
    ...loadedSource.source,
    displayName: "Postgres Prod",
    provider: "postgres",
    sourceKey: "postgres-prod",
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

const plan = {
  body: {
    kind: "text",
    value: "body text",
  },
  bodyKind: "text",
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
  provider: "github",
  requestFingerprint: "fp_123",
  selector: "/issues",
  selectorTemplate: "/{path}",
  sourceId: "source-1",
  sourceKey: "github-prod",
  url: "https://api.github.com/issues",
} as const;

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
  requestId: "rq_upstream_123",
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
  const executeSourceApi = vi.fn().mockResolvedValue(executionResponse);
  const dependencies = {
    buildCliRequestLogDetails: vi.fn(
      (_: unknown, details?: Record<string, unknown>) => ({
        method: "POST",
        path: "/connectrpc/onequery.cli.v1.CliService/DescribeSourceApi",
        requestId: "req_cli_123",
        ...(details ?? {}),
      })
    ),
    describeSourceApi: vi.fn().mockResolvedValue(descriptor),
    executeSourceApi,
    getCliLogLevelForStatus: vi.fn((): "info" => "info"),
    logCliEvent: vi.fn(),
    normalizeSourceApiRequest: vi.fn().mockResolvedValue(plan),
    prepareDataSourceCredentials: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        credentials: preparedSource.credentials,
      },
    }),
    requireCliConnectRequestContext: vi.fn().mockReturnValue(requestContext),
    runCliLoadSourceEffect: vi.fn().mockResolvedValue(loadedSource),
    toCliErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    ),
  };

  return {
    dependencies,
    executeSourceApi,
    handleDescribeSourceApi: createHandleDescribeSourceApi(dependencies),
    handleExecuteSourceApi: createHandleExecuteSourceApi(dependencies),
    handleNormalizeSourceApi: createHandleNormalizeSourceApi(dependencies),
    requestContext,
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
    expect(harness.requestContext.requireAuthorizedOrg).toHaveBeenCalledWith({
      action: "source_api.describe",
      orgSlug: "acme",
      session,
    });
    expect(harness.dependencies.runCliLoadSourceEffect).toHaveBeenCalledWith({
      db: honoContext.var.storage.db,
      effect: {
        kind: "load_source",
        organizationId: "org-1",
        sourceKey: "github-prod",
      },
    });
    expect(
      harness.dependencies.prepareDataSourceCredentials
    ).toHaveBeenCalledWith({
      dataSource: loadedSource.source,
      masterEncryptionKey: "master-key",
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

  it("rejects describe when org access cannot be resolved", async () => {
    const harness = createHarness();
    harness.requestContext.requireAuthorizedOrg.mockRejectedValue(
      new ConnectError("Organization not found", Code.NotFound)
    );
    const request = create(DescribeSourceApiRequestSchema, {
      orgSlug: "acme",
      sourceKey: "github-prod",
    });

    await expect(
      harness.handleDescribeSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.NotFound);
      expect((error as ConnectError).message).toContain(
        "Organization not found"
      );
      return true;
    });

    expect(harness.dependencies.runCliLoadSourceEffect).not.toHaveBeenCalled();
    expect(harness.dependencies.describeSourceApi).not.toHaveBeenCalled();
  });

  it("rejects describe when the source is not accessible in the org", async () => {
    const harness = createHarness();
    harness.dependencies.runCliLoadSourceEffect.mockResolvedValue({
      kind: "not_found",
    });
    const request = create(DescribeSourceApiRequestSchema, {
      orgSlug: "acme",
      sourceKey: "github-prod",
    });

    await expect(
      harness.handleDescribeSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.NotFound);
      expect((error as ConnectError).message).toContain(
        'no source named "github-prod" exists in org "acme"'
      );
      return true;
    });

    expect(
      harness.dependencies.prepareDataSourceCredentials
    ).not.toHaveBeenCalled();
    expect(harness.dependencies.describeSourceApi).not.toHaveBeenCalled();
  });

  it("maps unsupported describe providers to invalid arguments", async () => {
    const harness = createHarness();
    harness.dependencies.runCliLoadSourceEffect.mockResolvedValue(
      postgresLoadedSource
    );
    harness.dependencies.describeSourceApi.mockRejectedValue(
      new SourceApiAdapterNotRegisteredError("postgres")
    );
    const request = create(DescribeSourceApiRequestSchema, {
      orgSlug: "acme",
      sourceKey: "postgres-prod",
    });

    await expect(
      harness.handleDescribeSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
      expect((error as ConnectError).message).toContain(
        'No source API adapter is registered for provider "postgres"'
      );
      return true;
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
      source: {
        credentials: preparedSource.credentials,
        displayName: "Postgres Prod",
        id: "source-1",
        provider: "postgres",
        sourceKey: "postgres-prod",
      },
    });
  });

  it("maps unexpected describe failures to unknown", async () => {
    const harness = createHarness();
    harness.dependencies.describeSourceApi.mockRejectedValue(
      new Error("unexpected describe failure")
    );
    const request = create(DescribeSourceApiRequestSchema, {
      orgSlug: "acme",
      sourceKey: "github-prod",
    });

    await expect(
      harness.handleDescribeSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.Unknown);
      expect((error as ConnectError).message).toContain(
        "unexpected describe failure"
      );
      return true;
    });
  });

  it("executes the source API through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
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
        orgSlug: "acme",
        pageToken: "page_1",
        selector: "/issues",
        sourceKey: "github-prod",
      },
    });

    const response = await harness.handleExecuteSourceApi(request, {
      values: new Map(),
    } as never);

    expect(harness.requestContext.requireAuthorizedOrg).toHaveBeenCalledWith({
      action: "source_api.execute",
      orgSlug: "acme",
      session,
    });
    expect(harness.dependencies.describeSourceApi).not.toHaveBeenCalled();
    expect(harness.executeSourceApi).toHaveBeenCalledWith({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: "org-1",
        organizationSlug: "acme",
        requestId: "req_cli_123",
        userId: "user-1",
      },
      request: {
        body: {
          kind: "text",
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
        pageToken: "page_1",
        selector: "/issues",
      },
      source: preparedSource,
    });
    expect(response).toMatchObject({
      contentType: "text/plain",
      nextPageToken: "page_2",
      operation: "fetch",
      requestId: "rq_upstream_123",
      selector: "/issues",
      status: 200,
    });
    expect(response.body).toEqual({
      case: "text",
      value: "ok",
    });
  });

  it("normalizes the source API request through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(NormalizeSourceApiRequestSchema, {
      invocation: {
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
        orgSlug: "acme",
        selector: "/issues",
        sourceKey: "github-prod",
      },
    });

    const response = await harness.handleNormalizeSourceApi(request, {
      values: new Map(),
    } as never);

    expect(harness.requestContext.requireAuthorizedOrg).toHaveBeenCalledWith({
      action: "source_api.execute",
      orgSlug: "acme",
      session,
    });
    expect(harness.dependencies.normalizeSourceApiRequest).toHaveBeenCalledWith(
      {
        actor: {
          capabilities: authorizedOrg.capabilities,
          membershipRoles: authorizedOrg.membershipRoles,
          organizationId: "org-1",
          organizationSlug: "acme",
          requestId: "req_cli_123",
          userId: "user-1",
        },
        descriptor: {
          ...descriptor,
        },
        request: {
          body: {
            kind: "text",
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
          pageToken: undefined,
          selector: "/issues",
        },
        source: preparedSource,
      }
    );
    expect(harness.executeSourceApi).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      plan: {
        bodyKind: CliSourceApiBodyKind.TEXT,
        descriptorVersion: "github-v1",
        headerNames: ["accept"],
        host: "api.github.com",
        kind: CliSourceApiOperationKind.HTTP_REQUEST,
        method: "POST",
        operation: "fetch",
        provider: "github",
        requestFingerprint: "fp_123",
        selector: "/issues",
        selectorTemplate: "/{path}",
        sourceId: "source-1",
        sourceKey: "github-prod",
      },
    });
    expect((response.plan as Record<string, unknown>).headers).toBeUndefined();
    expect((response.plan as Record<string, unknown>).body).toBeUndefined();
    expect((response.plan as Record<string, unknown>).url).toBeUndefined();
  });

  it("maps unsupported normalize providers to invalid arguments", async () => {
    const harness = createHarness();
    harness.dependencies.runCliLoadSourceEffect.mockResolvedValue(
      postgresLoadedSource
    );
    harness.dependencies.describeSourceApi.mockRejectedValue(
      new SourceApiAdapterNotRegisteredError("postgres")
    );
    const request = create(NormalizeSourceApiRequestSchema, {
      invocation: {
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "postgres-prod",
      },
    });

    await expect(
      harness.handleNormalizeSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
      expect((error as ConnectError).message).toContain(
        'No source API adapter is registered for provider "postgres"'
      );
      return true;
    });

    expect(
      harness.dependencies.normalizeSourceApiRequest
    ).not.toHaveBeenCalled();
  });

  it("maps unexpected normalize request failures to unknown", async () => {
    const harness = createHarness();
    harness.dependencies.normalizeSourceApiRequest.mockRejectedValue(
      new Error("unexpected normalize failure")
    );
    const request = create(NormalizeSourceApiRequestSchema, {
      invocation: {
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleNormalizeSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.Unknown);
      expect((error as ConnectError).message).toContain(
        "unexpected normalize failure"
      );
      return true;
    });
  });

  it("rejects unsupported operations as invalid arguments", async () => {
    const harness = createHarness();
    harness.executeSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "normalize",
        new SourceApiUnsupportedOperationError("mutate")
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
        operation: "mutate",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
      expect((error as ConnectError).message).toContain(
        "Unsupported source API operation: mutate"
      );
      return true;
    });

    expect(harness.executeSourceApi).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid request headers as invalid arguments", async () => {
    const harness = createHarness();
    harness.executeSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "normalize",
        new SourceApiInvalidRequestError(
          "Unsupported request header: authorization"
        )
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
        headers: [
          {
            name: "authorization",
            value: "Bearer bad",
          },
        ],
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
      expect((error as ConnectError).message).toContain(
        "Unsupported request header: authorization"
      );
      return true;
    });

    expect(harness.executeSourceApi).toHaveBeenCalledTimes(1);
  });

  it("maps unexpected normalize execution failures to unknown", async () => {
    const harness = createHarness();
    harness.executeSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "normalize",
        new Error("unexpected normalize bug")
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.Unknown);
      expect((error as ConnectError).message).toContain(
        "unexpected normalize bug"
      );
      return true;
    });
  });

  it("maps descriptor version mismatches to failed precondition", async () => {
    const harness = createHarness();
    harness.executeSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "normalize",
        new SourceApiDescriptorVersionMismatchError({
          expectedDescriptorVersion: "github-v1",
          receivedDescriptorVersion: "github-v0",
        })
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((error as ConnectError).message).toContain(
        'descriptor_version mismatch: expected "github-v1", received "github-v0"'
      );
      return true;
    });
  });

  it("maps source api authorization failures to permission denied", async () => {
    const harness = createHarness();
    harness.executeSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "authorize",
        new SourceApiPermissionDeniedError({
          operation: "fetch",
          userId: "user-1",
        })
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.PermissionDenied);
      expect((error as ConnectError).message).toContain(
        'Actor "user-1" is not allowed to execute source API operation "fetch"'
      );
      return true;
    });
  });

  it("maps unexpected source api authorization failures to unknown", async () => {
    const harness = createHarness();
    harness.executeSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError("authorize", new Error("authorize bug"))
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.Unknown);
      expect((error as ConnectError).message).toContain("authorize bug");
      return true;
    });
  });

  it("maps adapter execution failures to connect errors", async () => {
    const harness = createHarness();
    harness.executeSourceApi.mockRejectedValue(
      new SourceApiExecutionStageError(
        "execute",
        new Error("GitHub upstream request failed")
      )
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      invocation: {
        operation: "fetch",
        orgSlug: "acme",
        sourceKey: "github-prod",
      },
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.Unknown);
      expect((error as ConnectError).message).toContain(
        "GitHub upstream request failed"
      );
      return true;
    });
  });
});
