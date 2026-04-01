import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";
import {
  loadStartupLaunchConfig,
  resolveStartupInputFromArgv,
} from "./startup";

function writeWorkspaceDevLaunchConfig(launchConfigPath: string): void {
  writeFileSync(
    launchConfigPath,
    JSON.stringify(
      {
        assets: {
          distDir: "/tmp/web",
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
      },
      null,
      2
    )
  );
}

function writeSelfHostLaunchConfig(launchConfigPath: string): void {
  writeFileSync(
    launchConfigPath,
    JSON.stringify(
      {
        assets: {
          distDir: "/tmp/web",
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
        mode: "self-host",
        publicOrigin: "http://127.0.0.1:5656",
        rateLimit: {
          enabled: true,
          storage: "persistent",
        },
        runtimePaths: {
          backupsDir: "/tmp/onequery/backups",
          dataDir: "/tmp/onequery/data",
          lockPath: "/tmp/onequery/run/server.lock",
          logsDir: "/tmp/onequery/logs",
          pidPath: "/tmp/onequery/run/server.pid",
          runDir: "/tmp/onequery/run",
        },
        storage: {
          dir: "/tmp/onequery/pglite",
          kind: "pglite",
        },
      },
      null,
      2
    )
  );
}

describe("bun-server startup", () => {
  it("accepts an in-memory launch config object", () => {
    const launchConfig = {
      assets: {
        distDir: "/tmp/web",
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

    expect(loadStartupLaunchConfig({ launchConfig })).toEqual(launchConfig);
  });

  it("loads a launch config from the explicit startup argv path", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-startup-"));
    const launchConfigPath = join(root, "launch.json");

    writeWorkspaceDevLaunchConfig(launchConfigPath);

    const startupInput = resolveStartupInputFromArgv([
      "bun",
      "src/index.ts",
      launchConfigPath,
    ]);

    expect(loadStartupLaunchConfig(startupInput)).toEqual({
      assets: {
        distDir: "/tmp/web",
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
  });

  it("loads a self-host launch config from the explicit startup argv path", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-startup-"));
    const launchConfigPath = join(root, "launch.json");

    writeSelfHostLaunchConfig(launchConfigPath);

    const startupInput = resolveStartupInputFromArgv([
      "bun",
      "src/index.ts",
      launchConfigPath,
    ]);

    expect(loadStartupLaunchConfig(startupInput)).toEqual({
      assets: {
        distDir: "/tmp/web",
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
      mode: "self-host",
      publicOrigin: "http://127.0.0.1:5656",
      rateLimit: {
        enabled: true,
        storage: "persistent",
      },
      runtimePaths: {
        backupsDir: "/tmp/onequery/backups",
        dataDir: "/tmp/onequery/data",
        lockPath: "/tmp/onequery/run/server.lock",
        logsDir: "/tmp/onequery/logs",
        pidPath: "/tmp/onequery/run/server.pid",
        runDir: "/tmp/onequery/run",
      },
      storage: {
        dir: "/tmp/onequery/pglite",
        kind: "pglite",
      },
    });
  });

  it("does not read repo-local workspace-dev files during self-host startup", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-startup-"));
    const launchConfigPath = join(root, "launch.json");

    // Comment: keep this in self-host mode. A workspace-dev launch config here
    // would make the acceptance check look stronger than it really is.
    writeFileSync(join(root, "onequery.dev.toml"), 'port = "not json"\n');
    writeFileSync(join(root, "onequery.dev.secrets.toml"), 'secret = "not toml"\n');
    writeSelfHostLaunchConfig(launchConfigPath);

    expect(loadStartupLaunchConfig({ launchConfigPath })).toMatchObject({
      mode: "self-host",
      publicOrigin: "http://127.0.0.1:5656",
      runtimePaths: {
        dataDir: "/tmp/onequery/data",
      },
    });
  });

  it("fails cleanly when the launch config file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-startup-"));
    const launchConfigPath = join(root, "missing.json");

    expect(() =>
      loadStartupLaunchConfig({
        launchConfigPath,
      })
    ).toThrow("Failed to read launch config file");
  });

  it("fails cleanly when the launch config file is malformed", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-startup-"));
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(launchConfigPath, "{not valid json");

    expect(() =>
      loadStartupLaunchConfig({
        launchConfigPath,
      })
    ).toThrow("Invalid launch config JSON");
  });

  it("fails fast when no launch config path is provided", () => {
    expect(() => resolveStartupInputFromArgv(["bun", "src/index.ts"])).toThrow(
      "Missing launch config path"
    );
  });
});
