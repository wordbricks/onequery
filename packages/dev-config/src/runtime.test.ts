import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadLocalDevRuntimeSync } from "./runtime";

describe("loadLocalDevRuntimeSync", () => {
  it("resolves the local dev runtime from managed defaults", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(loadLocalDevRuntimeSync({ rootDir })).toMatchObject({
      api: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1:4547",
        port: 4547,
      },
      auth: {
        origin: "http://localhost:4545",
      },
      database: {
        development: {
          database: "onequery",
          host: "localhost",
          port: 5454,
          url: "postgres://onequery:onequery@localhost:5454/onequery",
          user: "onequery",
        },
        test: {
          database: "test",
          host: "localhost",
          port: 5454,
          url: "postgres://test:test@localhost:5454/test",
          user: "test",
        },
      },
      postgres: {
        containerPort: 5432,
        hostPort: 5454,
      },
      web: {
        origin: "http://localhost:4545",
        port: 4545,
      },
    });
  });

  it("uses env overrides for the public web origin", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(
      loadLocalDevRuntimeSync({
        env: {
          BETTER_AUTH_URL: "http://127.0.0.1:4545",
          WEB_URL: "http://127.0.0.1:4545/",
        },
        rootDir,
      })
    ).toMatchObject({
      auth: {
        origin: "http://127.0.0.1:4545",
      },
      web: {
        origin: "http://127.0.0.1:4545",
        port: 4545,
      },
    });
  });

  it("loads managed local overrides from onequery.local.env.toml via zod-config", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));
    writeFileSync(
      join(rootDir, "onequery.local.env.toml"),
      [
        'BETTER_AUTH_URL = "http://127.0.0.1:4545"',
        'DATABASE_URL = "postgres://runtime:secret@127.0.0.1:5454/runtime"',
        'WEB_URL = "http://127.0.0.1:4545"',
      ].join("\n")
    );

    expect(loadLocalDevRuntimeSync({ rootDir })).toMatchObject({
      auth: {
        origin: "http://127.0.0.1:4545",
      },
      database: {
        development: {
          database: "runtime",
          host: "127.0.0.1",
          password: "secret",
          port: 5454,
          url: "postgres://runtime:secret@127.0.0.1:5454/runtime",
          user: "runtime",
        },
      },
      web: {
        origin: "http://127.0.0.1:4545",
        port: 4545,
      },
    });
  });

  it("rejects local dev web URLs without an explicit port", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(() =>
      loadLocalDevRuntimeSync({
        env: {
          BETTER_AUTH_URL: "http://localhost",
          WEB_URL: "http://localhost",
        },
        rootDir,
      })
    ).toThrow("WEB_URL must include an explicit port for local dev.");
  });

  it("rejects local dev web URLs whose port drifts from topology", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(() =>
      loadLocalDevRuntimeSync({
        env: {
          BETTER_AUTH_URL: "http://localhost:5999",
          WEB_URL: "http://localhost:5999",
        },
        rootDir,
      })
    ).toThrow("WEB_URL must use local dev web port 4545.");
  });

  it("rejects local dev web URLs with a path, query, or hash", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(() =>
      loadLocalDevRuntimeSync({
        env: {
          BETTER_AUTH_URL: "http://localhost:4545",
          WEB_URL: "http://localhost:4545/app?debug=1#hash",
        },
        rootDir,
      })
    ).toThrow("WEB_URL must be an origin without path, query, or hash.");
  });

  it("rejects split public origins in local dev", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(() =>
      loadLocalDevRuntimeSync({
        env: {
          BETTER_AUTH_URL: "http://127.0.0.1:4545",
          WEB_URL: "http://localhost:4545",
        },
        rootDir,
      })
    ).toThrow("BETTER_AUTH_URL must match WEB_URL in local dev.");
  });
});
