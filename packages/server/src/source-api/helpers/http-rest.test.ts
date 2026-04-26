import { describe, expect, it } from "vitest";

import {
  DEFAULT_SOURCE_API_CONTENT_TYPE,
  filterAllowedResponseHeaders,
  normalizeSourceApiContentType,
  readSourceApiHttpTransportResponse,
} from "./http-rest";

describe("source api http transport helpers", () => {
  it("normalizes missing content types to octet-stream", () => {
    expect(normalizeSourceApiContentType(undefined)).toBe(
      DEFAULT_SOURCE_API_CONTENT_TYPE
    );
    expect(normalizeSourceApiContentType(null)).toBe(
      DEFAULT_SOURCE_API_CONTENT_TYPE
    );
    expect(normalizeSourceApiContentType("  ")).toBe(
      DEFAULT_SOURCE_API_CONTENT_TYPE
    );
  });

  it("reads missing response content types as octet-stream", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
    });

    await expect(readSourceApiHttpTransportResponse(response)).resolves.toEqual(
      {
        body: {
          kind: "binary",
          value: new Uint8Array([1, 2, 3]),
        },
        contentType: DEFAULT_SOURCE_API_CONTENT_TYPE,
        headers: [],
        status: 200,
      }
    );
  });

  it("synthesizes fallback content types when response headers allow it", () => {
    expect(
      filterAllowedResponseHeaders({
        allowedNames: ["content-type"],
        contentType: DEFAULT_SOURCE_API_CONTENT_TYPE,
        headers: [],
      })
    ).toEqual([
      {
        name: "content-type",
        value: DEFAULT_SOURCE_API_CONTENT_TYPE,
      },
    ]);
  });
});
