import { describe, expect, it, vi } from "vitest";

import {
  SourceApiPermissionDeniedError,
  SourceApiTimeoutError,
} from "./errors";
import {
  executePreparedSourceApi,
  SourceApiExecutionStageError,
} from "./execute";
import { createSourceApiRegistry } from "./registry";
import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiAdapter,
} from "./types";

const source: PreparedSourceConnection = {
  credentials: { accessToken: "token", repositories: [], type: "github" },
  displayName: null,
  id: "source-id",
  provider: "github",
  sourceKey: "github-prod",
};

const prepared: PreparedSourceApi = {
  body: { kind: "none" },
  bodyKind: "none",
  bodyPaths: [],
  descriptorVersion: "v1",
  headerNames: [],
  headers: [],
  kind: "structured_request",
  method: "POST",
  operation: "fetch",
  paginationPolicy: "none",
  preparedBinding: "prepared_binding_123",
  provider: "github",
  request: {},
  selectorTemplate: "/noop",
  sourceId: "source-id",
  sourceKey: "github-prod",
};

describe("executePreparedSourceApi", () => {
  it("accepts prepared state and passes it directly to the provider adapter", async () => {
    const execute = vi.fn().mockResolvedValue({
      body: { kind: "none" },
      contentType: "application/json",
      headers: [],
      operation: "fetch",
      source: {
        sourceKey: "github-prod",
        provider: "github",
      },
      status: 200,
    });
    const adapter: SourceApiAdapter = {
      describe: vi.fn(async () => {
        throw new Error("describe should not run during prepared execution");
      }),
      execute,
      normalize: vi.fn(async () => {
        throw new Error("normalize should not run during prepared execution");
      }),
      provider: "github",
    };

    const response = await executePreparedSourceApi({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      continuation: {
        cursor: "page_2",
      },
      prepared,
      registry: createSourceApiRegistry([adapter]),
      source,
    });

    expect(execute).toHaveBeenCalledWith({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      continuation: {
        cursor: "page_2",
      },
      prepared,
      source,
    });
    expect(response.status).toBe(200);
  });

  it("rejects unauthorized prepared execution before provider I/O", async () => {
    const execute = vi.fn();
    const adapter: SourceApiAdapter = {
      describe: vi.fn(async () => {
        throw new Error("describe should not run during prepared execution");
      }),
      execute,
      normalize: vi.fn(async () => {
        throw new Error("normalize should not run during prepared execution");
      }),
      provider: "github",
    };

    try {
      await executePreparedSourceApi({
        actor: {
          capabilities: [],
          membershipRoles: ["owner"],
          organizationId: "org_1",
          organizationSlug: "acme",
          userId: "user_1",
        },
        prepared,
        registry: createSourceApiRegistry([adapter]),
        source,
      });
      throw new Error("expected executePreparedSourceApi to reject");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SourceApiExecutionStageError);
      expect((error as SourceApiExecutionStageError).stage).toBe("authorize");
      expect((error as SourceApiExecutionStageError).cause).toBeInstanceOf(
        SourceApiPermissionDeniedError
      );
      expect((error as Error).message).toContain(
        'Actor "user_1" is not allowed to execute source API operation "fetch"'
      );
    }

    expect(execute).not.toHaveBeenCalled();
  });

  it("normalizes abort causes into typed execute-stage timeouts", async () => {
    const abortError = new Error("operation aborted");
    abortError.name = "AbortError";
    const adapter: SourceApiAdapter = {
      describe: vi.fn(async () => {
        throw new Error("describe should not run during prepared execution");
      }),
      execute: vi.fn(async () => {
        throw new Error("GitHub request timeout after 30000ms", {
          cause: abortError,
        });
      }),
      normalize: vi.fn(async () => {
        throw new Error("normalize should not run during prepared execution");
      }),
      provider: "github",
    };

    await expect(
      executePreparedSourceApi({
        actor: {
          capabilities: ["source_api.execute"],
          membershipRoles: ["owner"],
          organizationId: "org_1",
          organizationSlug: "acme",
          userId: "user_1",
        },
        prepared,
        registry: createSourceApiRegistry([adapter]),
        source,
      })
    ).rejects.toMatchObject({
      cause: expect.any(SourceApiTimeoutError),
      stage: "execute",
    });
  });
});
