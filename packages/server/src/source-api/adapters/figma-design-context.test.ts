import type { JsonObject } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizePreparedSourceApi } from "../normalize";
import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { figmaSourceApiAdapter } from "./figma";

const originalFetch = globalThis.fetch;

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Figma grouped design context", () => {
  it("fetches nodes, renders, image fills, and optional variables together", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/variables/local")) {
          return Response.json({ meta: { variables: { color: "blue" } } });
        }
        if (url.includes("/files/") && url.endsWith("/images")) {
          return Response.json({
            images: { image_ref: "https://cdn.example.com/fill.png" },
          });
        }
        if (url.includes("/v1/images/")) {
          return Response.json({
            images: {
              "2578:39032": "https://cdn.example.com/reference.png",
            },
          });
        }
        return Response.json({
          nodes: {
            "2578:39032": {
              document: { id: "2578:39032", name: "Desktop" },
            },
          },
        });
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await executeDesignContext({
      fileKey: "wwSVz2qdnWZ2U8ZBwQE9QN",
      includeVariables: true,
      nodeIds: ["2578:39032"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        headers: expect.objectContaining({
          "X-Figma-Token": "figd_test_token",
        }),
        method: "GET",
      });
    }
    expect(response).toMatchObject({
      body: {
        kind: "json",
        value: {
          fileKey: "wwSVz2qdnWZ2U8ZBwQE9QN",
          imageFills: {
            images: { image_ref: "https://cdn.example.com/fill.png" },
          },
          localVariables: {
            meta: { variables: { color: "blue" } },
          },
          nodeIds: ["2578:39032"],
          nodes: {
            nodes: {
              "2578:39032": {
                document: { id: "2578:39032", name: "Desktop" },
              },
            },
          },
          renders: {
            images: {
              "2578:39032": "https://cdn.example.com/reference.png",
            },
          },
          warnings: [],
        },
      },
      operation: "prepare_design_context",
      status: 200,
    });
  });

  it("returns partial context when optional variable access is unavailable", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/variables/local")) {
        return new Response("Limited by Figma plan", { status: 403 });
      }
      return Response.json({});
    }) as unknown as typeof fetch;

    const response = await executeDesignContext({
      fileKey: "wwSVz2qdnWZ2U8ZBwQE9QN",
      includeImageFills: false,
      includeVariables: true,
      nodeIds: ["2578:39032"],
    });

    expect(response.body).toMatchObject({
      kind: "json",
      value: {
        imageFills: null,
        localVariables: null,
        warnings: [
          expect.stringContaining("Figma local variables are unavailable"),
        ],
      },
    });
  });
});

async function executeDesignContext(value: JsonObject) {
  const descriptor = await figmaSourceApiAdapter.describe({ actor, source });
  const plan = await figmaSourceApiAdapter.normalize({
    actor,
    descriptor,
    request: {
      body: { kind: "json", value },
      headers: [],
      operation: "prepare_design_context",
    },
    source,
  });

  return figmaSourceApiAdapter.execute({
    actor,
    prepared: finalizePreparedSourceApi(plan),
    source,
  });
}
