import { describe, expect, it } from "vitest";

import { decodeOpaquePageToken, encodeOpaquePageToken } from "./pagination";

describe("opaque source-api pagination tokens", () => {
  it("round-trips when the normalized request matches", () => {
    const token = encodeOpaquePageToken({
      payload: {
        descriptorVersion: "github.v1",
        expiresAt: "2026-04-09T12:05:00.000Z",
        issuedAt: "2026-04-09T12:00:00.000Z",
        operation: "fetch",
        requestFingerprint: "fingerprint_123",
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
          requestFingerprint: "fingerprint_123",
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
      requestFingerprint: "fingerprint_123",
      sourceKey: "github-prod",
      state: {
        cursor: "page_2",
      },
    });
  });

  it("rejects mismatched request fingerprints", () => {
    const token = encodeOpaquePageToken({
      payload: {
        expiresAt: "2026-04-09T12:05:00.000Z",
        issuedAt: "2026-04-09T12:00:00.000Z",
        operation: "fetch",
        requestFingerprint: "fingerprint_123",
        sourceKey: "github-prod",
        state: {},
      },
      secret: "top-secret",
    });

    expect(() =>
      decodeOpaquePageToken({
        expected: {
          operation: "fetch",
          requestFingerprint: "different_fingerprint",
          sourceKey: "github-prod",
        },
        now: new Date("2026-04-09T12:01:00.000Z"),
        secret: "top-secret",
        token,
      })
    ).toThrow("Pagination token request fingerprint mismatch");
  });
});
