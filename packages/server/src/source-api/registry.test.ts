import { describe, expect, it } from "vitest";

import {
  SourceApiAdapterNotRegisteredError,
  SourceApiRegistryConfigurationError,
} from "./errors";
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
          sourceKey: "source",
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
          sourceKey: "source",
          provider,
        },
        status: 200,
      };
    },
    async normalize() {
      return {
        body: { kind: "none" },
        descriptorVersion: "v1",
        headers: [],
        kind: "structured_request",
        method: "POST",
        metadata: {},
        operation: "noop",
        paginationPolicy: "none",
        provider,
        request: {},
        selectorTemplate: "/noop",
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

  it("rejects missing adapters with a typed request error", () => {
    const registry = createSourceApiRegistry([]);

    expect(() => getSourceApiAdapter(registry, "github")).toThrow(
      SourceApiAdapterNotRegisteredError
    );
  });

  it("rejects duplicate adapter registrations", () => {
    expect(() =>
      createSourceApiRegistry([
        createAdapter("github"),
        createAdapter("github"),
      ])
    ).toThrow(SourceApiRegistryConfigurationError);
  });
});
