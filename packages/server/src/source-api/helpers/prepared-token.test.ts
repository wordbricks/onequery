import { describe, expect, it } from "vitest";

import { SourceApiExpiredError, SourceApiInvalidRequestError } from "../errors";
import {
  decodePreparedSourceApiToken,
  encodePreparedSourceApiToken,
} from "./prepared-token";

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
  paginationPolicy: "none",
  preparedBinding: "prepared_binding_123",
  provider: "github",
  selector: "/releases/assets",
  selectorTemplate: "/{path}",
  sourceId: "source-1",
  sourceKey: "github-prod",
  url: "https://api.github.com/releases/assets",
} as const;

describe("prepared source api token", () => {
  it("round-trips prepared state and preserves binary request bodies", () => {
    const token = encodePreparedSourceApiToken({
      now: new Date("2026-04-10T00:00:00.000Z"),
      organizationSlug: "acme",
      prepared,
      secret: "secret",
      ttlMs: 60_000,
    });

    const decoded = decodePreparedSourceApiToken({
      now: new Date("2026-04-10T00:00:30.000Z"),
      secret: "secret",
      token,
    });

    expect(decoded.organizationSlug).toBe("acme");
    expect(decoded.prepared).toEqual(prepared);
    expect(decoded.version).toBe(1);
  });

  it("rejects tampered token signatures", () => {
    const token = encodePreparedSourceApiToken({
      now: new Date("2026-04-10T00:00:00.000Z"),
      organizationSlug: "acme",
      prepared,
      secret: "secret",
      ttlMs: 60_000,
    });
    const [payload, signature] = token.split(".");
    const tamperedSignature = `${signature?.slice(0, -1)}${signature?.endsWith("A") ? "B" : "A"}`;
    const tampered = `${payload}.${tamperedSignature}`;

    expect(() =>
      decodePreparedSourceApiToken({
        now: new Date("2026-04-10T00:00:30.000Z"),
        secret: "secret",
        token: tampered,
      })
    ).toThrow(SourceApiInvalidRequestError);
    expect(() =>
      decodePreparedSourceApiToken({
        now: new Date("2026-04-10T00:00:30.000Z"),
        secret: "secret",
        token: tampered,
      })
    ).toThrow("Invalid prepared token signature");
  });

  it("rejects expired tokens", () => {
    const token = encodePreparedSourceApiToken({
      now: new Date("2026-04-10T00:00:00.000Z"),
      organizationSlug: "acme",
      prepared,
      secret: "secret",
      ttlMs: 60_000,
    });

    expect(() =>
      decodePreparedSourceApiToken({
        now: new Date("2026-04-10T00:02:00.000Z"),
        secret: "secret",
        token,
      })
    ).toThrow(SourceApiExpiredError);
    expect(() =>
      decodePreparedSourceApiToken({
        now: new Date("2026-04-10T00:02:00.000Z"),
        secret: "secret",
        token,
      })
    ).toThrow("Prepared source API token expired");
  });
});
