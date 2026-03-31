import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../config/src/testing";
import { createSpaAssetBinding } from "./assets";
import {
  createWorkspaceDevLaunchConfig,
  loadLaunchConfigFile,
} from "./launch-config";

function createTempSpaBuildDir(): string {
  const assetDir = mkdtempSync(join(tmpdir(), "onequery-bun-spa-test-"));
  writeFileSync(
    join(assetDir, "index.html"),
    "<!doctype html><title>spa</title>"
  );
  return assetDir;
}

describe("launch config", () => {
  it("loads and validates a serialized workspace-dev launch config file", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify(
        {
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

    expect(loadLaunchConfigFile(launchConfigPath)).toEqual({
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

  it("loads and validates a serialized self-host launch config file", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify(
        {
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
          smtp: {
            fromEmail: "hello@example.com",
            host: "smtp.example.com",
            password: "smtp-pass",
            port: 587,
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

    expect(loadLaunchConfigFile(launchConfigPath)).toEqual({
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
      smtp: {
        fromEmail: "hello@example.com",
        host: "smtp.example.com",
        password: "smtp-pass",
        port: 587,
      },
      storage: {
        dir: "/tmp/onequery/pglite",
        kind: "pglite",
      },
    });
  });

  it("rejects invalid launch config files", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
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
        mode: "self-host",
        publicOrigin: "http://localhost:4545",
        rateLimit: {
          enabled: true,
          storage: "persistent",
        },
        storage: {
          kind: "postgres",
          url: "postgres://onequery:onequery@localhost:5454/onequery",
        },
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow(
      "runtimePaths"
    );
  });

  it("defaults the workspace-dev database URL to a pglite storage config when prefixed", () => {
    const assetDir = createTempSpaBuildDir();

    const launchConfig = createWorkspaceDevLaunchConfig({
      processEnv: {
        BETTER_AUTH_SECRET: "test-better-auth-secret",
        CONNECTOR_ENROLLMENT_TOKEN: "connector-token",
        DATABASE_URL: "pglite:/tmp/onequery/workspace-dev",
        HOST: "127.0.0.1",
        MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
        ONEQUERY_PUBLIC_ORIGIN: "http://localhost:4545",
        ONEQUERY_WEB_DIST_DIR: assetDir,
        PORT: "4555",
      },
    });

    expect(launchConfig.storage).toEqual({
      dir: "/tmp/onequery/workspace-dev",
      kind: "pglite",
    });
  });

  it("uses ONEQUERY_RUNTIME_ROOT to resolve relative runtime asset paths", async () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "onequery-runtime-root-"));
    const assetDir = join(runtimeRoot, "runtime", "web");
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(
      join(assetDir, "index.html"),
      "<!doctype html><title>rooted spa</title>"
    );

    const launchConfig = createWorkspaceDevLaunchConfig({
      processEnv: {
        BETTER_AUTH_SECRET: "test-better-auth-secret",
        CONNECTOR_ENROLLMENT_TOKEN: "connector-token",
        DATABASE_URL: "postgres://onequery:onequery@localhost:5454/onequery",
        HOST: "127.0.0.1",
        MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
        ONEQUERY_PUBLIC_ORIGIN: "http://localhost:4545",
        ONEQUERY_RUNTIME_ROOT: runtimeRoot,
        ONEQUERY_WEB_DIST_DIR: "runtime/web",
        PORT: "4555",
      },
    });

    const response = await createSpaAssetBinding({
      assetDir: launchConfig.assets.distDir,
    }).fetch(new Request("http://localhost:4545/"));

    await expect(response.text()).resolves.toContain("rooted spa");
  });

  it("rejects invalid PORT values with junk suffixes", () => {
    const assetDir = createTempSpaBuildDir();

    expect(() =>
      createWorkspaceDevLaunchConfig({
        processEnv: {
          BETTER_AUTH_SECRET: "test-better-auth-secret",
          CONNECTOR_ENROLLMENT_TOKEN: "connector-token",
          DATABASE_URL: "postgres://onequery:onequery@localhost:5454/onequery",
          HOST: "127.0.0.1",
          MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
          ONEQUERY_PUBLIC_ORIGIN: "http://localhost:4545",
          ONEQUERY_WEB_DIST_DIR: assetDir,
          PORT: "4545abc",
        },
      })
    ).toThrow("Invalid PORT value: 4545abc");
  });
});
