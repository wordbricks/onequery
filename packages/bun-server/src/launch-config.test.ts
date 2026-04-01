import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../config/src/testing";
import { loadLaunchConfigFile } from "./launch-config";

function createTempSpaBuildDir(): string {
  const assetDir = mkdtempSync(join(tmpdir(), "onequery-bun-spa-test-"));
  writeFileSync(
    join(assetDir, "index.html"),
    "<!doctype html><title>spa</title>"
  );
  return assetDir;
}

function createWorkspaceDevLaunchConfig(assetDir: string) {
  return {
    assets: {
      distDir: assetDir,
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
}

function createSelfHostLaunchConfig(assetDir: string) {
  return {
    assets: {
      distDir: assetDir,
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

describe("launch config", () => {
  it("loads and validates a serialized workspace-dev launch config file", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify(createWorkspaceDevLaunchConfig(assetDir), null, 2)
    );

    expect(loadLaunchConfigFile(launchConfigPath)).toEqual(
      createWorkspaceDevLaunchConfig(assetDir)
    );
  });

  it("loads and validates a serialized self-host launch config file", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify(createSelfHostLaunchConfig(assetDir), null, 2)
    );

    expect(loadLaunchConfigFile(launchConfigPath)).toEqual(
      createSelfHostLaunchConfig(assetDir)
    );
  });

  it("rejects self-host launch config files without runtimePaths", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
        ...createSelfHostLaunchConfig(assetDir),
        runtimePaths: undefined,
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow(
      "runtimePaths"
    );
  });

  it("rejects launch config files with unknown keys", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
        ...createWorkspaceDevLaunchConfig(assetDir),
        unexpected: true,
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow("unexpected");
  });

  it("rejects launch config files with missing required keys", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");
    const launchConfig = createWorkspaceDevLaunchConfig(assetDir);

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
        ...launchConfig,
        auth: undefined,
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow("auth");
  });

  it("rejects launch config files with invalid storage union members", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
        ...createWorkspaceDevLaunchConfig(assetDir),
        storage: {
          kind: "sqlite",
          path: "/tmp/onequery.sqlite",
        },
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow("storage.kind");
  });

  it("rejects launch config files with wrong scalar types", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");
    const launchConfig = createWorkspaceDevLaunchConfig(assetDir);

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
        ...launchConfig,
        listen: {
          ...launchConfig.listen,
          port: "4555",
        },
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow("listen.port");
  });
});
