import { describe, expect, it } from "vitest";

import { validateServerLaunchConfig } from "./server-launch";
import {
  createSelfHostLaunchConfig,
  createSelfHostRuntimePaths,
  createSelfHostSmtpConfig,
  createSelfHostSupervisorControl,
  createSelfHostSupervisor,
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
        backupsDir: "/tmp/onequery/backups",
        dataDir: "/tmp/onequery",
        lifecycleEventLogPath: "/tmp/onequery/run/lifecycle.events.pb",
        logsDir: "/tmp/onequery/logs",
        runDir: "/tmp/onequery/run",
        runtimeLeasePath: "/tmp/onequery/run/runtime.lease.json",
        runtimeStatusSnapshotPath: "/tmp/onequery/run/runtime.status.json",
      }),
      smtp: createSelfHostSmtpConfig({
        fromName: "OneQuery OSS",
        password: "smtp-pass",
        secure: false,
        username: "smtp-user",
      }),
      storageDir: "/tmp/onequery/pglite/onequery",
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

  it("requires Rust-stamped supervisor identity for self-host launch configs", () => {
    const { supervisor: _supervisor, ...launchConfig } =
      createSelfHostLaunchConfig();

    expect(() => validateServerLaunchConfig(launchConfig, "test")).toThrow(
      "supervisor"
    );
  });

  it("validates supervisor generation as a uint64 decimal string", () => {
    expect(() =>
      validateServerLaunchConfig(
        createSelfHostLaunchConfig({
          supervisor: createSelfHostSupervisor({
            generation: "0",
          }),
        }),
        "test"
      )
    ).toThrow("supervisor.generation");

    expect(() =>
      validateServerLaunchConfig(
        createSelfHostLaunchConfig({
          supervisor: createSelfHostSupervisor({
            generation: "18446744073709551616",
          }),
        }),
        "test"
      )
    ).toThrow("supervisor.generation");
  });

  it("requires supervisorControl for self-host launch configs", () => {
    const { supervisorControl: _supervisorControl, ...launchConfig } =
      createSelfHostLaunchConfig();

    expect(() => validateServerLaunchConfig(launchConfig, "test")).toThrow(
      "supervisorControl"
    );
  });

  it("requires supervisor control transport details to live under the transport object", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          supervisorControl: {
            baseUrl: "http://onequery-supervisor",
            maxMessageBytes: 64 * 1024,
            socketPath: "/tmp/onequery/supervisor-control.sock",
            transport: "unix",
          },
        },
        "test"
      )
    ).toThrow("supervisorControl.transport");
  });

  it("rejects non-UDS supervisor control transports until implemented", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          supervisorControl: {
            baseUrl: "http://onequery-supervisor",
            maxMessageBytes: 64 * 1024,
            transport: {
              host: "127.0.0.1",
              kind: "loopback-h2c",
              port: 5657,
            },
          },
        },
        "test"
      )
    ).toThrow("supervisorControl.transport.kind");
  });

  it("accepts unix supervisor control transport", () => {
    const launchConfig = createSelfHostLaunchConfig({
      supervisorControl: createSelfHostSupervisorControl({
        socketPath: "/tmp/onequery/supervisor-control.sock",
      }),
    });

    expect(validateServerLaunchConfig(launchConfig, "test")).toEqual(
      launchConfig
    );
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
