import { describe, expect, it } from "vitest";

import {
  DEFAULT_SOURCE_API_CONTENT_TYPE,
  createHttpRequestOperation,
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

  it("canonicalizes operation header policies for durable descriptors", () => {
    const operation = createHttpRequestOperation({
      allowedRequestHeaders: [
        "Accept",
        "Content-Type",
        "X-GitHub-Api-Version",
        "accept",
      ],
      allowedResponseHeaders: ["Content-Type", "ETag", "content-type"],
      description: "Fetch provider data.",
      name: "fetch",
      selectorKind: "path",
      summary: "Fetch.",
    });

    expect(operation.headerPolicy).toEqual({
      allowedRequestHeaders: ["accept", "content-type", "x-github-api-version"],
      allowedResponseHeaders: ["content-type", "etag"],
    });
  });
});
