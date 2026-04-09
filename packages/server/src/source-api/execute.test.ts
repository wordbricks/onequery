import { describe, expect, it } from "vitest";

import { executeSourceApi } from "./execute";
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
          bodyKind: "none",
          headers: [],
          headerNames: [],
          kind: "structured_request",
          operation: "fetch",
          provider: "github",
          request: {},
          requestFingerprint: "fingerprint",
          sourceId: "source-id",
          sourceKey: "github-prod",
        };
      },
      provider: "github",
    };

    const source: PreparedSourceConnection = {
      credentials: { accessToken: "token", repositories: [], type: "github" },
      credentialsEncrypted: "enc",
      credentialsIv: "iv",
      displayName: null,
      id: "source-id",
      name: "github-prod",
      organizationId: "org_1",
      provider: "github",
      sourceKey: "github-prod",
      status: "active",
      useAsDataSource: true,
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
});
