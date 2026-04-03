import {
  SAMPLE_MASTER_ENCRYPTION_KEY,
  createSelfHostLaunchConfig,
  createSelfHostSmtpConfig,
  createWorkspaceDevLaunchConfig,
} from "@onequery/config/testing";
import { describe, expect, it } from "vitest";

import { createServerRuntimeConfig } from "./runtime";
import { deriveKeyFromBase64 } from "./services/crypto/credential-encryption";

describe("createServerRuntimeConfig", () => {
  it("maps a postgres launch contract into a typed runtime config", () => {
    const runtime = createServerRuntimeConfig(
      createWorkspaceDevLaunchConfig({
        assetsDistDir: "/tmp/web",
        authSecret: "auth-secret",
        migrationsDir: "/tmp/migrations",
      })
    );

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
        masterEncryptionKey: deriveKeyFromBase64(SAMPLE_MASTER_ENCRYPTION_KEY),
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
    const runtime = createServerRuntimeConfig(
      createSelfHostLaunchConfig({
        assetsDistDir: "/tmp/web",
        authSecret: "auth-secret",
        migrationsDir: "/tmp/migrations",
        publicOrigin: "https://onequery.example.com",
        runtimePaths: {
          backupsDir: "/tmp/runtime/backups",
          dataDir: "/tmp/runtime/data",
          lockPath: "/tmp/runtime/run/server.lock",
          logsDir: "/tmp/runtime/logs",
          pidPath: "/tmp/runtime/run/server.pid",
          runDir: "/tmp/runtime/run",
        },
        smtp: createSelfHostSmtpConfig({
          fromName: "OneQuery",
          password: "smtp-password",
          secure: true,
          username: "smtp-user",
        }),
        storageDir: "/tmp/runtime/pglite/onequery",
      })
    );

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
