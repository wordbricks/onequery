import { describe, expect, it } from "vitest";

import { SourceApiPermissionDeniedError } from "./errors";
import { executeSourceApi, SourceApiExecutionStageError } from "./execute";
import { createSourceApiRegistry } from "./registry";
import type { PreparedSourceConnection, SourceApiAdapter } from "./types";

describe("executeSourceApi", () => {
  it("runs the describe -> normalize -> authorize -> execute pipeline", async () => {
    const calls: string[] = [];
    const adapter: SourceApiAdapter = {
      async describe() {
        calls.push("describe");
        return {
          descriptorVersion: "v1",
          examples: [],
          notes: [],
          operations: [],
          source: {
            key: "github-prod",
            provider: "github",
          },
        };
      },
      async execute() {
        calls.push("execute");
        return {
          body: { kind: "none" },
          contentType: "application/json",
          headers: [],
          operation: "fetch",
          source: {
            key: "github-prod",
            provider: "github",
          },
          status: 200,
        };
      },
      async normalize() {
        calls.push("normalize");
        return {
          body: { kind: "none" },
          headers: [],
          kind: "structured_request",
          method: "POST",
          operation: "fetch",
          paginationPolicy: "none",
          provider: "github",
          request: {},
          selectorTemplate: "/noop",
          sourceId: "source-id",
          sourceKey: "github-prod",
        };
      },
      provider: "github",
    };

    const source: PreparedSourceConnection = {
      credentials: { accessToken: "token", repositories: [], type: "github" },
      displayName: null,
      id: "source-id",
      provider: "github",
      sourceKey: "github-prod",
    };

    const response = await executeSourceApi({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      registry: createSourceApiRegistry([adapter]),
      request: {
        body: { kind: "none" },
        headers: [],
        operation: "fetch",
      },
      source,
    });

    expect(calls).toEqual(["describe", "normalize", "execute"]);
    expect(response.status).toBe(200);
  });

  it("authorizes after normalization and before execute", async () => {
    const calls: string[] = [];
    const adapter: SourceApiAdapter = {
      async describe() {
        calls.push("describe");
        return {
          descriptorVersion: "v1",
          examples: [],
          notes: [],
          operations: [],
          source: {
            key: "github-prod",
            provider: "github",
          },
        };
      },
      async execute() {
        calls.push("execute");
        throw new Error("should not execute");
      },
      async normalize() {
        calls.push("normalize");
        return {
          body: { kind: "none" },
          headers: [],
          kind: "structured_request",
          method: "POST",
          operation: "fetch",
          paginationPolicy: "none",
          provider: "github",
          request: {},
          selectorTemplate: "/noop",
          sourceId: "source-id",
          sourceKey: "github-prod",
        };
      },
      provider: "github",
    };

    const source: PreparedSourceConnection = {
      credentials: { accessToken: "token", repositories: [], type: "github" },
      displayName: null,
      id: "source-id",
      provider: "github",
      sourceKey: "github-prod",
    };

    try {
      await executeSourceApi({
        actor: {
          capabilities: [],
          membershipRoles: ["owner"],
          organizationId: "org_1",
          organizationSlug: "acme",
          userId: "user_1",
        },
        registry: createSourceApiRegistry([adapter]),
        request: {
          body: { kind: "none" },
          headers: [],
          operation: "fetch",
        },
        source,
      });
      throw new Error("expected executeSourceApi to reject");
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

    expect(calls).toEqual(["describe", "normalize"]);
  });
});
