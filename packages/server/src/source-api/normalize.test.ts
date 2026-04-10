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
  displayName: null,
  id: "source_id",
  provider: "github",
  sourceKey: "github-prod",
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
    expect(plan.bodyPaths).toEqual([]);
    expect(plan.headerNames).toEqual([]);
    expect(plan.host).toBe("api.github.com");
    expect(plan.method).toBe("GET");
    expect(plan.selectorTemplate).toBe("/{path}");
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
        selectorTemplate: "/{path}",
        url: "https://api.github.com/pulls",
      }).requestFingerprint
    );
  });

  it("derives structured request body paths from the normalized request object", () => {
    const plan = finalizeNormalizedExecutionPlan({
      body: {
        kind: "json",
        value: {
          ignored: true,
        },
      },
      descriptorVersion: "posthog.v1",
      headers: [],
      kind: "structured_request",
      method: "post",
      operation: "run_query",
      provider: "posthog",
      request: {
        query: {
          kind: "TrendsQuery",
          series: [{ event: "Signup" }],
        },
        refresh: "force_async",
      },
      selectorTemplate: "/api/projects/{projectId}/query/",
      sourceId: "source_id",
      sourceKey: "posthog-prod",
    });

    expect(plan.method).toBe("POST");
    expect(plan.bodyPaths).toEqual([
      "query",
      "query[kind]",
      "query[series]",
      "query[series][]",
      "refresh",
    ]);
    expect(plan.selectorTemplate).toBe("/api/projects/{projectId}/query/");
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
      bodyPaths: ["ok"],
      headerNames: ["x-test", "x-trace-id"],
      host: "api.github.com",
      kind: "http_request",
      method: "POST",
      selector: "/repos/acme/widgets",
      selectorTemplate: "/{path}",
    });
    expect(plan.requestFingerprint.length).toBeGreaterThan(0);
  });
});
