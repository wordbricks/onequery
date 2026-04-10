import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SourceApiExpiredError, SourceApiInvalidRequestError } from "../errors";
import { decodeOpaquePageToken, encodeOpaquePageToken } from "./pagination";

describe("opaque source-api pagination tokens", () => {
  it("round-trips when the prepared binding matches", () => {
    const token = encodeOpaquePageToken({
      payload: {
        descriptorVersion: "github.v1",
        expiresAt: "2026-04-09T12:05:00.000Z",
        issuedAt: "2026-04-09T12:00:00.000Z",
        operation: "fetch",
        preparedBinding: "prepared_123",
        sourceKey: "github-prod",
        state: {
          cursor: "page_2",
        },
      },
      secret: "top-secret",
    });

    expect(
      decodeOpaquePageToken({
        expected: {
          descriptorVersion: "github.v1",
          operation: "fetch",
          preparedBinding: "prepared_123",
          sourceKey: "github-prod",
        },
        now: new Date("2026-04-09T12:01:00.000Z"),
        secret: "top-secret",
        token,
      })
    ).toEqual({
      descriptorVersion: "github.v1",
      expiresAt: "2026-04-09T12:05:00.000Z",
      issuedAt: "2026-04-09T12:00:00.000Z",
      operation: "fetch",
      preparedBinding: "prepared_123",
      sourceKey: "github-prod",
      state: {
        cursor: "page_2",
      },
    });
  });

  it("rejects mismatched prepared bindings", () => {
    const token = encodeOpaquePageToken({
      payload: {
        expiresAt: "2026-04-09T12:05:00.000Z",
        issuedAt: "2026-04-09T12:00:00.000Z",
        operation: "fetch",
        preparedBinding: "prepared_123",
        sourceKey: "github-prod",
        state: {},
      },
      secret: "top-secret",
    });

    expect(() =>
      decodeOpaquePageToken({
        expected: {
          operation: "fetch",
          preparedBinding: "different_binding",
          sourceKey: "github-prod",
        },
        now: new Date("2026-04-09T12:01:00.000Z"),
        secret: "top-secret",
        token,
      })
    ).toThrow("Pagination token prepared binding mismatch");
  });

  it("rejects malformed payloads with a typed request error", () => {
    const payload = Buffer.from("{", "utf8").toString("base64url");
    const signature = createHmac("sha256", "top-secret")
      .update(payload)
      .digest("base64url");

    expect(() =>
      decodeOpaquePageToken({
        expected: {
          operation: "fetch",
          preparedBinding: "prepared_123",
          sourceKey: "github-prod",
        },
        now: new Date("2026-04-09T12:01:00.000Z"),
        secret: "top-secret",
        token: `${payload}.${signature}`,
      })
    ).toThrow(SourceApiInvalidRequestError);
  });

  it("maps expired tokens to the source-api expired error", () => {
    const token = encodeOpaquePageToken({
      payload: {
        expiresAt: "2026-04-09T12:05:00.000Z",
        issuedAt: "2026-04-09T12:00:00.000Z",
        operation: "fetch",
        preparedBinding: "prepared_123",
        sourceKey: "github-prod",
        state: {},
      },
      secret: "top-secret",
    });

    expect(() =>
      decodeOpaquePageToken({
        expected: {
          operation: "fetch",
          preparedBinding: "prepared_123",
          sourceKey: "github-prod",
        },
        now: new Date("2026-04-09T12:06:00.000Z"),
        secret: "top-secret",
        token,
      })
    ).toThrow(SourceApiExpiredError);
  });
});
