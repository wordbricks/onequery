import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateServerLaunchConfig } from "./server-launch";
import { SAMPLE_MASTER_ENCRYPTION_KEY } from "./testing";

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures"
);

function createWorkspaceDevLaunchConfig() {
  return {
    assets: {
      distDir: "/tmp/onequery/runtime/web",
    },
    auth: {
      secret: "workspace-auth-secret",
    },
    connectors: {
      enrollmentToken: "connector-token",
    },
    crypto: {
      masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
    },
    listen: {
      host: "127.0.0.1",
      port: 4555,
    },
    migrations: {
      dir: "/tmp/onequery/runtime/migrations",
    },
    mode: "workspace-dev" as const,
    publicOrigin: "http://localhost:4545",
    rateLimit: {
      enabled: false,
      storage: "memory" as const,
    },
    storage: {
      kind: "postgres" as const,
      url: "postgres://onequery:onequery@localhost:5454/onequery",
    },
  };
}

function createSelfHostLaunchConfig() {
  return {
    assets: {
      distDir: "/tmp/onequery/runtime/web",
    },
    auth: {
      secret: "self-host-auth-secret",
    },
    connectors: {
      enrollmentToken: "connector-token",
    },
    crypto: {
      masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
    },
    listen: {
      host: "127.0.0.1",
      port: 5656,
    },
    migrations: {
      dir: "/tmp/onequery/runtime/migrations",
    },
    mode: "self-host" as const,
    publicOrigin: "http://127.0.0.1:5656",
    rateLimit: {
      enabled: true,
      storage: "persistent" as const,
    },
    runtimePaths: {
      backupsDir: "/tmp/onequery/backups",
      dataDir: "/tmp/onequery/data",
      lockPath: "/tmp/onequery/run/server.lock",
      logsDir: "/tmp/onequery/logs",
      pidPath: "/tmp/onequery/run/server.pid",
      runDir: "/tmp/onequery/run",
    },
    smtp: {
      fromEmail: "hello@example.com",
      host: "smtp.example.com",
      password: "smtp-pass",
      port: 587,
    },
    storage: {
      dir: "/tmp/onequery/pglite",
      kind: "pglite" as const,
    },
  };
}

describe("server launch contract", () => {
  it("accepts the shared self-host launch fixture", () => {
    const fixturePath = resolve(fixtureDir, "self-host-launch.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

    expect(
      validateServerLaunchConfig(fixture, `fixture ${fixturePath}`)
    ).toEqual(fixture);
  });

  it("rejects unknown keys", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          unexpected: true,
        },
        "test"
      )
    ).toThrow("unexpected");
  });

  it("rejects missing required keys", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          auth: undefined,
        },
        "test"
      )
    ).toThrow("auth");
  });

  it("rejects wrong scalar types", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          listen: {
            host: "127.0.0.1",
            port: "4555",
          },
        },
        "test"
      )
    ).toThrow("listen.port");
  });

  it("rejects invalid storage union members", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          storage: {
            kind: "sqlite",
            path: "/tmp/onequery.sqlite",
          },
        },
        "test"
      )
    ).toThrow("storage.kind");
  });

  it("requires runtimePaths for persistent rate limiting", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          rateLimit: {
            enabled: true,
            storage: "persistent",
          },
        },
        "test"
      )
    ).toThrow("runtimePaths");
  });

  it("requires runtimePaths for self-host launch config", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          rateLimit: {
            enabled: false,
            storage: "memory",
          },
          runtimePaths: undefined,
        },
        "test"
      )
    ).toThrow("runtimePaths");
  });
});
