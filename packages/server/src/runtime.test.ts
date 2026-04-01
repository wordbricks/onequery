import { describe, expect, it } from "vitest";

import { createServerRuntimeConfig } from "./runtime";

describe("createServerRuntimeConfig", () => {
  it("maps a postgres launch contract into a typed runtime config", () => {
    const runtime = createServerRuntimeConfig({
      assets: {
        distDir: "/tmp/web",
      },
      auth: {
        secret: "auth-secret",
      },
      connectors: {
        enrollmentToken: "connector-token",
      },
      crypto: {
        masterEncryptionKey: "master-key",
      },
      listen: {
        host: "127.0.0.1",
        port: 4555,
      },
      mode: "workspace-dev",
      publicOrigin: "http://localhost:4545",
      rateLimit: {
        enabled: false,
        storage: "memory",
      },
      storage: {
        kind: "postgres",
        url: "postgres://onequery:onequery@localhost:5454/onequery",
      },
    });

    expect(runtime).toEqual({
      auth: {
        baseURL: "http://localhost:4545",
        emailDelivery: {
          baseURL: "http://localhost:4545",
        },
        secret: "auth-secret",
      },
      connectors: {
        enrollmentToken: "connector-token",
      },
      crypto: {
        masterEncryptionKey: "master-key",
      },
      listen: {
        host: "127.0.0.1",
        port: 4555,
      },
      mode: "workspace-dev",
      publicOrigin: "http://localhost:4545",
      rateLimit: {
        enabled: false,
        runtimeStorage: undefined,
        storage: "memory",
      },
      runtimePaths: undefined,
      storage: {
        connectionString:
          "postgres://onequery:onequery@localhost:5454/onequery",
        kind: "postgres",
        url: "postgres://onequery:onequery@localhost:5454/onequery",
      },
    });
  });

  it("maps smtp and pglite launch settings without falling back to env defaults", () => {
    const runtime = createServerRuntimeConfig({
      assets: {
        distDir: "/tmp/web",
      },
      auth: {
        secret: "auth-secret",
      },
      connectors: {
        enrollmentToken: "connector-token",
      },
      crypto: {
        masterEncryptionKey: "master-key",
      },
      listen: {
        host: "127.0.0.1",
        port: 5656,
      },
      mode: "self-host",
      publicOrigin: "https://onequery.example.com",
      rateLimit: {
        enabled: true,
        storage: "persistent",
      },
      runtimePaths: {
        backupsDir: "/tmp/runtime/backups",
        dataDir: "/tmp/runtime/data",
        lockPath: "/tmp/runtime/run/server.lock",
        logsDir: "/tmp/runtime/logs",
        pidPath: "/tmp/runtime/run/server.pid",
        runDir: "/tmp/runtime/run",
      },
      smtp: {
        fromEmail: "hello@example.com",
        fromName: "OneQuery",
        host: "smtp.example.com",
        password: "smtp-password",
        port: 587,
        secure: true,
        username: "smtp-user",
      },
      storage: {
        dir: "/tmp/runtime/pglite/onequery",
        kind: "pglite",
      },
    });

    expect(runtime.storage).toEqual({
      connectionString: "pglite:/tmp/runtime/pglite/onequery",
      dir: "/tmp/runtime/pglite/onequery",
      kind: "pglite",
    });
    expect(runtime.auth.emailDelivery).toEqual({
      baseURL: "https://onequery.example.com",
      smtp: {
        fromEmail: "hello@example.com",
        fromName: "OneQuery",
        host: "smtp.example.com",
        password: "smtp-password",
        port: 587,
        secure: true,
        username: "smtp-user",
      },
    });
  });
});
