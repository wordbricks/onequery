import { describe, expect, it } from "vitest";

import { validateServerLaunchConfig } from "./server-launch";
import {
  createSelfHostLaunchConfig,
  createSelfHostRuntimePaths,
  createSelfHostSmtpConfig,
  createWorkspaceDevLaunchConfig,
} from "./testing";

describe("server launch contract", () => {
  it("accepts a workspace-dev launch config sample", () => {
    const launchConfig = createWorkspaceDevLaunchConfig();

    expect(validateServerLaunchConfig(launchConfig, "test")).toEqual(
      launchConfig
    );
  });

  it("accepts a self-host launch config sample with runtime-only fields", () => {
    const launchConfig = createSelfHostLaunchConfig({
      runtimePaths: createSelfHostRuntimePaths({
        backupsDir: "/tmp/onequery/data/backups",
        dataDir: "/tmp/onequery/data",
        lockPath: "/tmp/onequery/data/run/server.lock",
        logsDir: "/tmp/onequery/data/logs",
        pidPath: "/tmp/onequery/data/run/server.pid",
        runDir: "/tmp/onequery/data/run",
      }),
      smtp: createSelfHostSmtpConfig({
        fromName: "OneQuery OSS",
        password: "smtp-pass",
        secure: false,
        username: "smtp-user",
      }),
      storageDir: "/tmp/onequery/data/pglite/onequery",
    });

    expect(validateServerLaunchConfig(launchConfig, "test")).toEqual(
      launchConfig
    );
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
            api: {
              storage: "persistent",
            },
            enabled: true,
          },
        },
        "test"
      )
    ).toThrow("runtimePaths");
  });

  it("rejects master keys that do not decode to exactly 32 bytes", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          crypto: {
            masterEncryptionKey: "master",
          },
        },
        "test"
      )
    ).toThrow("crypto.masterEncryptionKey");
  });
});
