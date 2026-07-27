import { describe, expect, it } from "vitest";

import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { figmaSourceApiAdapter } from "./figma";

const actor: SourceApiActorContext = {
  capabilities: ["source_api.describe", "source_api.execute"],
  membershipRoles: ["owner"],
  organizationId: "org_1",
  organizationSlug: "acme",
  userId: "user_1",
};

const source: PreparedSourceConnection = {
  credentials: {
    personalAccessToken: "figd_test_token",
    type: "figma",
  },
  displayName: "Product design",
  id: "source_1",
  provider: "figma",
  sourceKey: "figma-design",
};

describe("Figma source API adapter", () => {
  it("describes raw REST and grouped design-context operations", async () => {
    const descriptor = await figmaSourceApiAdapter.describe({ actor, source });

    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "fetch_api",
      "prepare_design_context",
    ]);
    expect(descriptor.defaultPathOperation).toBe("fetch_api");
  });

  it("normalizes Figma frame URLs into a grouped request", async () => {
    const descriptor = await figmaSourceApiAdapter.describe({ actor, source });
    const plan = await figmaSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: {
          kind: "json",
          value: {
            includeVariables: true,
            url: "https://www.figma.com/design/wwSVz2qdnWZ2U8ZBwQE9QN/NEW-GetGPT?node-id=2578-39032",
          },
        },
        headers: [],
        operation: "prepare_design_context",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "structured_request",
      operation: "prepare_design_context",
      provider: "figma",
      request: {
        fileKey: "wwSVz2qdnWZ2U8ZBwQE9QN",
        includeImageFills: true,
        includeVariables: true,
        nodeIds: ["2578:39032"],
        renderFormat: "png",
        renderScale: 2,
      },
      selectorTemplate: "/v1/files/{fileKey}/nodes",
    });
  });

  it("normalizes raw read-only Figma REST requests", async () => {
    const descriptor = await figmaSourceApiAdapter.describe({ actor, source });
    const plan = await figmaSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: {
          params: { ids: "2578:39032" },
        },
        headers: [],
        operation: "fetch_api",
        selector: "/v1/files/wwSVz2qdnWZ2U8ZBwQE9QN/nodes",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "http_request",
      method: "GET",
      operation: "fetch_api",
      url: "https://api.figma.com/v1/files/wwSVz2qdnWZ2U8ZBwQE9QN/nodes?ids=2578%3A39032",
    });
  });

  it("rejects non-Figma design URLs", async () => {
    const descriptor = await figmaSourceApiAdapter.describe({ actor, source });

    await expect(
      figmaSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: {
            kind: "json",
            value: {
              url: "https://example.com/design/file/frame?node-id=1-2",
            },
          },
          headers: [],
          operation: "prepare_design_context",
        },
        source,
      })
    ).rejects.toThrow("Invalid Figma design context request");
  });
});
