import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadLocalDevRuntimeSync } from "./runtime";
import {
  LOCAL_DATABASE_URL,
  LOCAL_TEST_DATABASE_URL,
  LOCAL_TOPOLOGY,
} from "./topology";

describe("loadLocalDevRuntimeSync", () => {
  const bundledOrigin = LOCAL_TOPOLOGY.web.bundled.origin;
  const bundledLoopbackOrigin = LOCAL_TOPOLOGY.web.bundled.loopbackOrigin;
  const devBrowserOrigin = LOCAL_TOPOLOGY.web.devBrowser.origin;

  it("resolves the local dev runtime from managed defaults", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(loadLocalDevRuntimeSync({ rootDir })).toMatchObject({
      api: {
        host: LOCAL_TOPOLOGY.loopbackHost,
        origin: LOCAL_TOPOLOGY.web.api.origin,
        port: LOCAL_TOPOLOGY.web.api.port,
      },
      auth: {
        origin: bundledOrigin,
      },
      database: {
        development: {
          database: "onequery",
          host: "localhost",
          port: LOCAL_TOPOLOGY.postgres.hostPort,
          url: LOCAL_DATABASE_URL,
          user: "onequery",
        },
        test: {
          database: "test",
          host: "localhost",
          port: LOCAL_TOPOLOGY.postgres.hostPort,
          url: LOCAL_TEST_DATABASE_URL,
          user: "test",
        },
      },
      postgres: {
        containerPort: LOCAL_TOPOLOGY.postgres.containerPort,
        hostPort: LOCAL_TOPOLOGY.postgres.hostPort,
      },
      web: {
        bundled: {
          origin: bundledOrigin,
          port: LOCAL_TOPOLOGY.web.bundled.port,
        },
        devBrowser: {
          origin: devBrowserOrigin,
          port: LOCAL_TOPOLOGY.web.devBrowser.port,
        },
      },
    });
  });

  it("uses env overrides for the public web origin", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(
      loadLocalDevRuntimeSync({
        env: {
          BETTER_AUTH_URL: bundledLoopbackOrigin,
          WEB_URL: `${bundledLoopbackOrigin}/`,
        },
        rootDir,
      })
    ).toMatchObject({
      auth: {
        origin: bundledLoopbackOrigin,
      },
      web: {
        bundled: {
          origin: bundledLoopbackOrigin,
          port: LOCAL_TOPOLOGY.web.bundled.port,
        },
        devBrowser: {
          origin: devBrowserOrigin,
          port: LOCAL_TOPOLOGY.web.devBrowser.port,
        },
      },
    });
  });

  it("loads managed local overrides from onequery.local.env.toml via zod-config", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));
    writeFileSync(
      join(rootDir, "onequery.local.env.toml"),
      [
        `BETTER_AUTH_URL = "${bundledLoopbackOrigin}"`,
        `DATABASE_URL = "postgres://runtime:secret@127.0.0.1:${LOCAL_TOPOLOGY.postgres.hostPort}/runtime"`,
        `WEB_URL = "${bundledLoopbackOrigin}"`,
      ].join("\n")
    );

    expect(loadLocalDevRuntimeSync({ rootDir })).toMatchObject({
      auth: {
        origin: bundledLoopbackOrigin,
      },
      database: {
        development: {
          database: "runtime",
          host: "127.0.0.1",
          password: "secret",
          port: LOCAL_TOPOLOGY.postgres.hostPort,
          url: `postgres://runtime:secret@127.0.0.1:${LOCAL_TOPOLOGY.postgres.hostPort}/runtime`,
          user: "runtime",
        },
      },
      web: {
        bundled: {
          origin: bundledLoopbackOrigin,
          port: LOCAL_TOPOLOGY.web.bundled.port,
        },
        devBrowser: {
          origin: devBrowserOrigin,
          port: LOCAL_TOPOLOGY.web.devBrowser.port,
        },
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
    ).toThrow(
      `WEB_URL must use local bundled web port ${LOCAL_TOPOLOGY.web.bundled.port}.`
    );
  });

  it("rejects local dev web URLs with a path, query, or hash", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-dev-runtime-"));

    expect(() =>
      loadLocalDevRuntimeSync({
        env: {
          BETTER_AUTH_URL: bundledOrigin,
          WEB_URL: `${bundledOrigin}/app?debug=1#hash`,
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
          BETTER_AUTH_URL: bundledLoopbackOrigin,
          WEB_URL: bundledOrigin,
        },
        rootDir,
      })
    ).toThrow("BETTER_AUTH_URL must match WEB_URL in local dev.");
  });
});
