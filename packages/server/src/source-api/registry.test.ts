import { describe, expect, it } from "vitest";

import { createSourceApiRegistry, getSourceApiAdapter } from "./registry";
import type { SourceApiAdapter } from "./types";

function createAdapter(
  provider: SourceApiAdapter["provider"]
): SourceApiAdapter {
  return {
    async describe() {
      return {
        descriptorVersion: "v1",
        examples: [],
        notes: [],
        operations: [],
        source: {
          key: "source",
          provider,
        },
      };
    },
    async execute() {
      return {
        body: { kind: "none" },
        contentType: "application/json",
        headers: [],
        operation: "noop",
        source: {
          key: "source",
          provider,
        },
        status: 200,
      };
    },
    async normalize() {
      return {
        body: { kind: "none" },
        bodyKind: "none",
        descriptorVersion: "v1",
        headers: [],
        headerNames: [],
        kind: "structured_request",
        metadata: {},
        operation: "noop",
        provider,
        request: {},
        requestFingerprint: "fingerprint",
        sourceId: "source-id",
        sourceKey: "source",
      };
    },
    provider,
  };
}

describe("createSourceApiRegistry", () => {
  it("returns registered adapters by provider", () => {
    const adapter = createAdapter("github");
    const registry = createSourceApiRegistry([adapter]);

    expect(getSourceApiAdapter(registry, "github")).toBe(adapter);
  });

  it("rejects duplicate adapter registrations", () => {
    expect(() =>
      createSourceApiRegistry([
        createAdapter("github"),
        createAdapter("github"),
      ])
    ).toThrow(
      'Duplicate source API adapter registration for provider "github"'
    );
  });
});
