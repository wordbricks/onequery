import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";
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

  it("wraps missing file errors", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));

    expect(() => loadLaunchConfigFile(join(root, "missing.json"))).toThrow(
      "Failed to read launch config file"
    );
  });

  it("wraps filesystem read errors", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const launchConfigPath = join(root, "launch-dir");

    mkdirSync(launchConfigPath, { recursive: true });

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow(
      "Failed to read launch config file"
    );
  });

  it("wraps invalid JSON syntax", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(launchConfigPath, "{");

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow(
      "Invalid launch config JSON"
    );
  });

  it("surfaces validator errors from the contract owner", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
        ...createSelfHostLaunchConfig(createTempSpaBuildDir()),
        runtimePaths: undefined,
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow("runtimePaths");
  });
});
