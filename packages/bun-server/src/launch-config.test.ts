import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../dev-config/src/master-encryption-key";
import { createSpaAssetBinding } from "./assets";
import {
  createSelfHostLaunchConfig,
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

function createSelfHostPaths(root: string) {
  const configDir = join(root, "config", "self-host");
  const dataDir = join(root, "data");

  return {
    backupsDir: join(dataDir, "backups"),
    configDir,
    configPath: join(configDir, "config.toml"),
    dataDir,
    lockPath: join(dataDir, "run", "server.lock"),
    logsDir: join(dataDir, "logs"),
    pidPath: join(dataDir, "run", "server.pid"),
    pgliteDir: join(dataDir, "pglite", "onequery"),
    runDir: join(dataDir, "run"),
    secretsPath: join(configDir, "secrets.toml"),
    serverLogPath: join(dataDir, "logs", "server.log"),
  };
}

describe("launch config", () => {
  it("loads and validates a serialized launch config file", () => {
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

  it("defaults the self-host database URL to the self-host PGlite path", () => {
    const assetDir = createTempSpaBuildDir();
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-runtime-config-"));
    const selfHostPaths = createSelfHostPaths(root);

    const launchConfig = createSelfHostLaunchConfig({
      processEnv: {
        BETTER_AUTH_SECRET: "test-better-auth-secret",
        CONNECTOR_ENROLLMENT_TOKEN: "connector-token",
        MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
        ONEQUERY_PUBLIC_ORIGIN: "http://localhost:4545",
        ONEQUERY_WEB_DIST_DIR: assetDir,
      },
      selfHostPaths,
    });

    expect(launchConfig.storage).toEqual({
      dir: selfHostPaths.pgliteDir,
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

    const root = mkdtempSync(join(tmpdir(), "onequery-bun-runtime-config-"));
    const launchConfig = createSelfHostLaunchConfig({
      processEnv: {
        BETTER_AUTH_SECRET: "test-better-auth-secret",
        CONNECTOR_ENROLLMENT_TOKEN: "connector-token",
        MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
        ONEQUERY_PUBLIC_ORIGIN: "http://localhost:4545",
        ONEQUERY_RUNTIME_ROOT: runtimeRoot,
        ONEQUERY_WEB_DIST_DIR: "runtime/web",
      },
      selfHostPaths: createSelfHostPaths(root),
    });

    const response = await createSpaAssetBinding({
      assetDir: launchConfig.assets.distDir,
    }).fetch(new Request("http://localhost:4545/"));

    await expect(response.text()).resolves.toContain("rooted spa");
  });

  it("loads auth, public origin, and SMTP settings from self-host TOML config", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-runtime-config-"));
    const selfHostPaths = createSelfHostPaths(root);
    const assetDir = createTempSpaBuildDir();
    mkdirSync(selfHostPaths.configDir, { recursive: true });
    mkdirSync(selfHostPaths.dataDir, { recursive: true });
    writeFileSync(
      selfHostPaths.configPath,
      [
        "[server]",
        'listen_host = "127.0.0.1"',
        "port = 4848",
        'public_origin = "https://onequery.example.com"',
        "",
        "[smtp]",
        'host = "smtp.example.com"',
        "port = 587",
        'from_email = "hello@example.com"',
        'from_name = "OneQuery OSS"',
        'username = "smtp-user"',
        "secure = false",
      ].join("\n")
    );
    writeFileSync(
      selfHostPaths.secretsPath,
      [
        "[auth]",
        'better_auth_secret = "secret-from-file"',
        "",
        "[crypto]",
        `master_encryption_key = "${SAMPLE_MASTER_ENCRYPTION_KEY}"`,
        "",
        "[connectors]",
        'enrollment_token = "connector-from-file"',
        "",
        "[smtp]",
        'password = "smtp-pass-from-file"',
      ].join("\n")
    );

    const launchConfig = createSelfHostLaunchConfig({
      processEnv: {
        ONEQUERY_WEB_DIST_DIR: assetDir,
      },
      selfHostPaths,
    });

    expect(launchConfig.listen).toEqual({
      host: "127.0.0.1",
      port: 4848,
    });
    expect(launchConfig.auth.secret).toBe("secret-from-file");
    expect(launchConfig.publicOrigin).toBe("https://onequery.example.com");
    expect(launchConfig.connectors.enrollmentToken).toBe("connector-from-file");
    expect(launchConfig.smtp).toEqual({
      fromEmail: "hello@example.com",
      fromName: "OneQuery OSS",
      host: "smtp.example.com",
      password: "smtp-pass-from-file",
      port: 587,
      secure: false,
      username: "smtp-user",
    });
  });

  it("rejects invalid PORT values with junk suffixes", () => {
    const assetDir = createTempSpaBuildDir();
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-runtime-config-"));

    expect(() =>
      createSelfHostLaunchConfig({
        processEnv: {
          BETTER_AUTH_SECRET: "test-better-auth-secret",
          CONNECTOR_ENROLLMENT_TOKEN: "connector-token",
          MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
          ONEQUERY_PUBLIC_ORIGIN: "http://localhost:4545",
          ONEQUERY_WEB_DIST_DIR: assetDir,
          PORT: "4545abc",
        },
        selfHostPaths: createSelfHostPaths(root),
      })
    ).toThrow("Invalid PORT value: 4545abc");
  });
});
