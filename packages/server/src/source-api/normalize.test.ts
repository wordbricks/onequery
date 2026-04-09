import { describe, expect, it } from "vitest";

import {
  createSourceApiRequestFingerprint,
  finalizeNormalizedExecutionPlan,
  normalizeSourceApiRequest,
} from "./normalize";
import { createSourceApiRegistry } from "./registry";
import type { PreparedSourceConnection, SourceApiAdapter } from "./types";

const actor = {
  capabilities: ["source_api.execute"],
  membershipRoles: ["owner"],
  organizationId: "org_1",
  organizationSlug: "acme",
  userId: "user_1",
} as const;

const source: PreparedSourceConnection = {
  credentials: { accessToken: "token", repositories: [], type: "github" },
  credentialsEncrypted: "enc",
  credentialsIv: "iv",
  displayName: null,
  id: "source_id",
  name: "github-prod",
  organizationId: "org_1",
  provider: "github",
  sourceKey: "github-prod",
  status: "active",
  useAsDataSource: true,
};

const descriptor = {
  descriptorVersion: "github.v1",
  examples: [],
  notes: [],
  operations: [],
  source: {
    key: "github-prod",
    provider: "github",
  },
} as const;

describe("createSourceApiRequestFingerprint", () => {
  it("is stable across object key order", () => {
    expect(
      createSourceApiRequestFingerprint({
        headers: { b: 2, a: 1 },
        request: { selector: "/pulls" },
      })
    ).toBe(
      createSourceApiRequestFingerprint({
        request: { selector: "/pulls" },
        headers: { a: 1, b: 2 },
      })
    );
  });
});

describe("finalizeNormalizedExecutionPlan", () => {
  it("adds a deterministic fingerprint", () => {
    const plan = finalizeNormalizedExecutionPlan({
      body: { kind: "none" },
      descriptorVersion: "github.v1",
      headers: [],
      kind: "http_request",
      method: " get ",
      operation: "fetch",
      provider: "github",
      sourceId: "source_id",
      sourceKey: "github-prod",
      url: "https://api.github.com/pulls",
    });

    expect(plan.requestFingerprint.length).toBeGreaterThan(0);
    expect(plan.bodyKind).toBe("none");
    expect(plan.headerNames).toEqual([]);
    expect(plan.method).toBe("GET");
    expect(plan.requestFingerprint).toBe(
      finalizeNormalizedExecutionPlan({
        body: { kind: "none" },
        descriptorVersion: "github.v1",
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch",
        provider: "github",
        sourceId: "source_id",
        sourceKey: "github-prod",
        url: "https://api.github.com/pulls",
      }).requestFingerprint
    );
  });
});

describe("normalizeSourceApiRequest", () => {
  it("rejects descriptor version mismatches before adapter normalization", async () => {
    const adapter: SourceApiAdapter = {
      async describe() {
        return descriptor;
      },
      async execute() {
        throw new Error("not used");
      },
      async normalize() {
        throw new Error("should not run");
      },
      provider: "github",
    };

    const registry = createSourceApiRegistry([adapter]);

    await expect(
      normalizeSourceApiRequest({
        actor,
        descriptor,
        registry,
        request: {
          body: { kind: "none" },
          descriptorVersion: "github.v2",
          headers: [],
          operation: "fetch",
        },
        source,
      })
    ).rejects.toThrow(
      'descriptor_version mismatch: expected "github.v1", received "github.v2"'
    );
  });

  it("finalizes policy metadata before returning the normalized plan", async () => {
    const adapter: SourceApiAdapter = {
      async describe() {
        return descriptor;
      },
      async execute() {
        throw new Error("not used");
      },
      async normalize() {
        return {
          body: { kind: "json", value: { ok: true } },
          bodyKind: "text",
          headers: [
            { name: " X-Test ", value: "one" },
            { name: "x-test", value: "two" },
            { name: "X-Trace-Id", value: "abc" },
          ],
          headerNames: ["wrong"],
          kind: "http_request",
          method: " post ",
          operation: "fetch",
          provider: "github",
          selector: " /repos/acme/widgets ",
          sourceId: "source_id",
          sourceKey: "github-prod",
          url: "https://api.github.com/repos/acme/widgets",
        };
      },
      provider: "github",
    };

    const registry = createSourceApiRegistry([adapter]);
    const plan = await normalizeSourceApiRequest({
      actor,
      descriptor,
      registry,
      request: {
        body: { kind: "none" },
        headers: [],
        operation: "fetch",
      },
      source,
    });

    expect(plan).toMatchObject({
      bodyKind: "json",
      headerNames: ["x-test", "x-trace-id"],
      kind: "http_request",
      method: "POST",
      selector: "/repos/acme/widgets",
    });
    expect(plan.requestFingerprint.length).toBeGreaterThan(0);
  });
});
