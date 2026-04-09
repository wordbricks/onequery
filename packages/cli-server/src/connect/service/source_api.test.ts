import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DescribeSourceApiRequestSchema,
  ExecuteSourceApiRequestSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  createHandleDescribeSourceApi,
  createHandleExecuteSourceApi,
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
      command: "onequery use --source github-prod /issues",
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
  const adapterExecute = vi.fn().mockResolvedValue(executionResponse);
  const dependencies = {
    authorizeSourceApi: vi.fn().mockResolvedValue(undefined),
    buildCliRequestLogDetails: vi.fn((_: unknown, details: unknown) => details),
    describeSourceApi: vi.fn().mockResolvedValue(descriptor),
    getCliLogLevelForStatus: vi.fn(() => "info"),
    getSourceApiAdapter: vi.fn().mockReturnValue({
      execute: adapterExecute,
    }),
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
    sourceApiRegistry: { kind: "test-registry" },
    toCliErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    ),
  };

  return {
    adapterExecute,
    dependencies,
    handleDescribeSourceApi: createHandleDescribeSourceApi(dependencies),
    handleExecuteSourceApi: createHandleExecuteSourceApi(dependencies),
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
    expect(response.operations.map((operation) => operation.name)).toEqual([
      "fetch",
    ]);
  });

  it("executes the source API through the Connect handler", async () => {
    const harness = createHarness();
    const request = create(ExecuteSourceApiRequestSchema, {
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
    });

    const response = await harness.handleExecuteSourceApi(request, {
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
          pageToken: "page_1",
          selector: "/issues",
        },
        source: preparedSource,
      }
    );
    expect(harness.dependencies.authorizeSourceApi).toHaveBeenCalledWith({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: "org-1",
        organizationSlug: "acme",
        requestId: "req_cli_123",
        userId: "user-1",
      },
      plan,
    });
    expect(harness.adapterExecute).toHaveBeenCalledWith({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: "org-1",
        organizationSlug: "acme",
        requestId: "req_cli_123",
        userId: "user-1",
      },
      plan,
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

  it("maps descriptor version mismatches to failed precondition", async () => {
    const harness = createHarness();
    harness.dependencies.normalizeSourceApiRequest.mockRejectedValue(
      new Error("descriptor_version mismatch: stale descriptor")
    );
    const request = create(ExecuteSourceApiRequestSchema, {
      operation: "fetch",
      orgSlug: "acme",
      sourceKey: "github-prod",
    });

    await expect(
      harness.handleExecuteSourceApi(request, {
        values: new Map(),
      } as never)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((error as ConnectError).message).toContain(
        "descriptor_version mismatch: stale descriptor"
      );
      return true;
    });
  });
});
