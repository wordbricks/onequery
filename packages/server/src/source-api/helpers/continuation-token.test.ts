import { createHmac } from "node:crypto";

import { base64UrlToUtf8 } from "@onequery/codecs/base64";
import { describe, expect, it } from "vitest";

import { SourceApiExpiredError, SourceApiInvalidRequestError } from "../errors";
import {
  decodeSourceApiContinuationToken,
  encodeSourceApiContinuationToken,
} from "./continuation-token";

const prepared = {
  body: {
    kind: "binary",
    value: new Uint8Array([1, 2, 3, 4]),
  },
  bodyKind: "binary",
  bodyPaths: [],
  descriptorVersion: "github-v1",
  headerNames: ["accept"],
  headers: [
    {
      name: "accept",
      value: "application/octet-stream",
    },
  ],
  host: "api.github.com",
  kind: "http_request",
  method: "POST",
  operation: "upload",
  paginationPolicy: "continuation_token",
  preparedBinding: "prepared_binding_123",
  provider: "github",
  selector: "/releases/assets",
  selectorTemplate: "/{path}",
  sourceId: "source-1",
  sourceKey: "github-prod",
  url: "https://api.github.com/releases/assets",
} as const;

describe("source api continuation token", () => {
  it("round-trips prepared state, continuation state, and binary request bodies", () => {
    const token = encodeSourceApiContinuationToken({
      now: new Date("2026-04-10T00:00:00.000Z"),
      prepared,
      secret: "secret",
      state: {
        cursor: "page_2",
      },
      ttlMs: 60_000,
    });

    const decoded = decodeSourceApiContinuationToken({
      now: new Date("2026-04-10T00:00:30.000Z"),
      secret: "secret",
      token,
    });

    expect(decoded).toEqual({
      expiresAt: "2026-04-10T00:01:00.000Z",
      issuedAt: "2026-04-10T00:00:00.000Z",
      prepared,
      state: {
        cursor: "page_2",
      },
      version: 2,
    });
  });

  it("rejects tampered continuation token signatures", () => {
    const token = encodeSourceApiContinuationToken({
      now: new Date("2026-04-10T00:00:00.000Z"),
      prepared,
      secret: "secret",
      state: {
        cursor: "page_2",
      },
      ttlMs: 60_000,
    });
    const [payload, signature] = token.split(".");
    const tamperedSignature = `${signature?.slice(0, -1)}${signature?.endsWith("A") ? "B" : "A"}`;
    const tampered = `${payload}.${tamperedSignature}`;

    expect(() =>
      decodeSourceApiContinuationToken({
        now: new Date("2026-04-10T00:00:30.000Z"),
        secret: "secret",
        token: tampered,
      })
    ).toThrow(SourceApiInvalidRequestError);
    expect(() =>
      decodeSourceApiContinuationToken({
        now: new Date("2026-04-10T00:00:30.000Z"),
        secret: "secret",
        token: tampered,
      })
    ).toThrow("Invalid source API continuation token signature");
  });

  it("rejects expired continuation tokens", () => {
    const token = encodeSourceApiContinuationToken({
      now: new Date("2026-04-10T00:00:00.000Z"),
      prepared,
      secret: "secret",
      state: {
        cursor: "page_2",
      },
      ttlMs: 60_000,
    });

    expect(() =>
      decodeSourceApiContinuationToken({
        now: new Date("2026-04-10T00:02:00.000Z"),
        secret: "secret",
        token,
      })
    ).toThrow(SourceApiExpiredError);
    expect(() =>
      decodeSourceApiContinuationToken({
        now: new Date("2026-04-10T00:02:00.000Z"),
        secret: "secret",
        token,
      })
    ).toThrow("Source API continuation token expired");
  });

  it("preserves JSON bodies that use the binary sentinel key literally", () => {
    const token = encodeSourceApiContinuationToken({
      now: new Date("2026-04-10T00:00:00.000Z"),
      prepared: {
        ...prepared,
        body: {
          kind: "json",
          value: {
            valueBase64Url: "literal-value",
            nested: {
              valueBase64Url: "still-literal",
            },
          },
        },
        bodyKind: "json",
      },
      secret: "secret",
      state: {
        cursor: "page_2",
      },
      ttlMs: 60_000,
    });

    const decoded = decodeSourceApiContinuationToken({
      now: new Date("2026-04-10T00:00:30.000Z"),
      secret: "secret",
      token,
    });

    expect(decoded.prepared.body).toEqual({
      kind: "json",
      value: {
        valueBase64Url: "literal-value",
        nested: {
          valueBase64Url: "still-literal",
        },
      },
    });
  });

  it("rejects signed payloads with malformed binary bodies", () => {
    const payload = base64UrlToUtf8.encode(
      JSON.stringify({
        expiresAt: "2026-04-10T00:01:00.000Z",
        issuedAt: "2026-04-10T00:00:00.000Z",
        prepared: {
          ...prepared,
          body: {
            kind: "binary",
            valueBase64Url: "not-valid-base64url!",
          },
        },
        state: {
          cursor: "page_2",
        },
        version: 2,
      })
    );
    const signature = createHmac("sha256", "secret")
      .update(payload)
      .digest("base64url");

    expect(() =>
      decodeSourceApiContinuationToken({
        now: new Date("2026-04-10T00:00:30.000Z"),
        secret: "secret",
        token: `${payload}.${signature}`,
      })
    ).toThrow(SourceApiInvalidRequestError);
    expect(() =>
      decodeSourceApiContinuationToken({
        now: new Date("2026-04-10T00:00:30.000Z"),
        secret: "secret",
        token: `${payload}.${signature}`,
      })
    ).toThrow("Invalid source API continuation token");
  });
});
