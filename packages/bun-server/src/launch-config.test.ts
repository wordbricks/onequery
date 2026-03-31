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
});
