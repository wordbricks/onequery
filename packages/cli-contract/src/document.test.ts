import { describe, expect, test } from "bun:test";

import { cliOpenApiDocument, getCliOpenApiDocument } from "./document";

describe("cli contract document", () => {
  test("returns a detached clone of the bundled openapi document", () => {
    const first = getCliOpenApiDocument();
    const second = getCliOpenApiDocument();

    (first as unknown as { paths: Record<string, unknown> }).paths = {};

    expect(second).toEqual(cliOpenApiDocument);
  });

  test("keeps fixed-shape cli request bodies closed", () => {
    const document = getCliOpenApiDocument();
    const schemas = document.components?.schemas ?? {};

    expect(schemas.CliAuthDeviceAuthorizationPollRequest).toMatchObject({
      additionalProperties: false,
    });
    expect(schemas.CliQueryRequest).toMatchObject({
      additionalProperties: false,
    });
  });
});
