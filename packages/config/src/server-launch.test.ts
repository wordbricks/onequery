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
        lifecycleEventLogPath: "/tmp/onequery/data/run/lifecycle.events.pb",
        logsDir: "/tmp/onequery/data/logs",
        runDir: "/tmp/onequery/data/run",
        runtimeLeasePath: "/tmp/onequery/data/run/runtime.lease.json",
        runtimeStatusSnapshotPath: "/tmp/onequery/data/run/runtime.status.json",
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

  it("requires launchId for self-host launch configs", () => {
    const { launchId: _launchId, ...launchConfig } =
      createSelfHostLaunchConfig();

    expect(() => validateServerLaunchConfig(launchConfig, "test")).toThrow(
      "launchId"
    );
  });

  it("requires runtimeControl for self-host launch configs", () => {
    const { runtimeControl: _runtimeControl, ...launchConfig } =
      createSelfHostLaunchConfig();

    expect(() => validateServerLaunchConfig(launchConfig, "test")).toThrow(
      "runtimeControl"
    );
  });

  it("requires runtime control transport details to live under the transport object", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          runtimeControl: {
            socketPath: "/tmp/onequery/runtime-control.sock",
            transport: "unix",
          },
        },
        "test"
      )
    ).toThrow("runtimeControl.transport");
  });

  it("requires launch-scoped auth and fencing for non-UDS runtime control transports", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          runtimeControl: {
            transport: {
              host: "127.0.0.1",
              kind: "loopback-h2c",
              port: 5657,
            },
          },
        },
        "test"
      )
    ).toThrow("runtimeControl.transport.auth");

    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          runtimeControl: {
            transport: {
              auth: {
                kind: "bearer",
                token: "launch-token",
              },
              host: "127.0.0.1",
              kind: "loopback-h2c",
              port: 5657,
            },
          },
        },
        "test"
      )
    ).toThrow("runtimeControl.transport.fencing");

    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          runtimeControl: {
            transport: {
              auth: {
                kind: "bearer",
                token: "launch-token",
              },
              fencing: {
                dataDir: "/tmp/onequery/data",
                launchId: "launch-a",
              },
              host: "127.0.0.1",
              kind: "loopback-h2c",
              port: 5657,
            },
          },
        },
        "test"
      )
    ).toThrow("Non-UDS runtime control requires launchId");

    const launchConfig = createSelfHostLaunchConfig({
      launchId: "launch-a",
      runtimeControl: {
        transport: {
          auth: {
            kind: "bearer",
            token: "launch-token",
          },
          fencing: {
            dataDir: "/tmp/onequery/data",
            launchId: "launch-a",
          },
          host: "127.0.0.1",
          kind: "loopback-h2c",
          port: 5657,
        },
      },
    });

    expect(validateServerLaunchConfig(launchConfig, "test")).toEqual(
      launchConfig
    );

    expect(() =>
      validateServerLaunchConfig(
        createSelfHostLaunchConfig({
          launchId: "launch-a",
          runtimeControl: {
            transport: {
              auth: {
                kind: "bearer",
                token: "launch-token",
              },
              fencing: {
                dataDir: "/tmp/onequery/data",
                launchId: "launch-b",
              },
              host: "127.0.0.1",
              kind: "loopback-h2c",
              port: 5657,
            },
          },
        }),
        "test"
      )
    ).toThrow("runtimeControl.transport.fencing.launchId");

    expect(() =>
      validateServerLaunchConfig(
        createSelfHostLaunchConfig({
          launchId: "launch-a",
          runtimeControl: {
            transport: {
              auth: {
                kind: "bearer",
                token: "launch-token",
              },
              fencing: {
                dataDir: "/tmp/other-onequery/data",
                launchId: "launch-a",
              },
              host: "127.0.0.1",
              kind: "loopback-h2c",
              port: 5657,
            },
          },
        }),
        "test"
      )
    ).toThrow("runtimeControl.transport.fencing.dataDir");
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
