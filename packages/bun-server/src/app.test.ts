import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOCAL_TEST_DATABASE_URL } from "@onequery/dev-config/topology";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../dev-config/src/master-encryption-key";
import { app } from "./app";
import { createPersistentRuntimeRateLimitStorage } from "./rate-limit-storage";
import {
  createRuntimeConfig,
  createRuntimeEnv as buildRuntimeEnv,
} from "./runtime-env";
import type { BunRuntimeEnv } from "./runtime-env";

function createTestRuntimeEnv(
  overrides: Partial<BunRuntimeEnv> = {}
): BunRuntimeEnv {
  return {
    BETTER_AUTH_SECRET: "test-better-auth-secret",
    BETTER_AUTH_URL: "http://localhost:4545",
    CONNECTOR_ENROLLMENT_TOKEN: "test-connector-token",
    DATABASE_URL: LOCAL_TEST_DATABASE_URL,
    DISABLE_RATE_LIMIT: true,
    MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
    RATE_LIMIT_STORAGE: createPersistentRuntimeRateLimitStorage(
      mkdtempSync(join(tmpdir(), "onequery-rate-limit-test-"))
    ),
    SPA_ASSETS: {
      fetch: vi.fn(
        async () =>
          new Response("<!doctype html><title>spa</title>", {
            headers: {
              "content-type": "text/html;charset=utf-8",
            },
          })
      ),
    },
    WEB_URL: "http://localhost:4545",
    ...overrides,
  };
}

function createTempSpaBuildDir(): string {
  const assetDir = mkdtempSync(join(tmpdir(), "onequery-bun-spa-test-"));
  writeFileSync(
    join(assetDir, "index.html"),
    "<!doctype html><title>spa</title>"
  );
  return assetDir;
}

describe("bun runtime app", () => {
  const originalConsoleLog = console.log;

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it("serves the SPA shell and API routes from the same app", async () => {
    console.log = () => {};
    const env = createTestRuntimeEnv();
    const rootResponse = await app.fetch(new Request("http://local/"), env);
    const healthResponse = await app.fetch(
      new Request("http://local/api/health"),
      env
    );

    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get("content-type")).toContain("text/html");
    await expect(rootResponse.text()).resolves.toContain("<title>spa</title>");

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      status: "ok",
    });

    expect(env.SPA_ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an API 404 instead of the SPA shell for missing API paths", async () => {
    console.log = () => {};
    const env = createTestRuntimeEnv();
    const response = await app.fetch(
      new Request("http://local/api/missing"),
      env
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("404 Not Found");
    expect(env.SPA_ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the SPA shell for non-api client routes", async () => {
    console.log = () => {};
    const env = createTestRuntimeEnv();
    const response = await app.fetch(
      new Request("http://local/settings/profile"),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(env.SPA_ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the installer script for curl-like root requests before the SPA shell", async () => {
    console.log = () => {};
    const env = createTestRuntimeEnv();
    const response = await app.fetch(
      new Request("http://local/", {
        headers: {
          "user-agent": "curl/8.7.1",
        },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "text/x-shellscript"
    );
    await expect(response.text()).resolves.toContain(
      'root_tarball_url="$RELEASE_BASE_URL/onequery-npm.tgz"'
    );
    expect(env.SPA_ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("defaults the runtime database URL to the self-host PGlite path", () => {
    const assetDir = createTempSpaBuildDir();
    const env = buildRuntimeEnv({
      processEnv: {
        BETTER_AUTH_SECRET: "test-better-auth-secret",
        BETTER_AUTH_URL: "http://localhost:4545",
        MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
        ONEQUERY_WEB_DIST_DIR: assetDir,
        ONEQUERY_SELF_HOST_DATA_DIR: "/tmp/onequery-data/onequery",
        WEB_URL: "http://localhost:4545",
      },
      selfHostPaths: {
        backupsDir: "/tmp/onequery-data/onequery/backups",
        configDir: "/tmp/onequery-config/onequery/self-host",
        dataDir: "/tmp/onequery-data/onequery",
        lockPath: "/tmp/onequery-data/onequery/run/server.lock",
        logsDir: "/tmp/onequery-data/onequery/logs",
        pidPath: "/tmp/onequery-data/onequery/run/server.pid",
        runDir: "/tmp/onequery-data/onequery/run",
        secretsPath: "/tmp/onequery-config/onequery/self-host/secrets.toml",
        configPath: "/tmp/onequery-config/onequery/self-host/config.toml",
        serverLogPath: "/tmp/onequery-data/onequery/logs/server.log",
        pgliteDir: "/tmp/onequery-data/onequery/pglite/onequery",
      },
    });

    expect(env.DATABASE_URL).toBe(
      "pglite:/tmp/onequery-data/onequery/pglite/onequery"
    );
  });

  it("uses ONEQUERY_RUNTIME_ROOT to resolve relative runtime asset paths", async () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "onequery-runtime-root-"));
    const assetDir = join(runtimeRoot, "runtime", "web");
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(
      join(assetDir, "index.html"),
      "<!doctype html><title>rooted spa</title>"
    );

    const runtime = createRuntimeConfig({
      processEnv: {
        BETTER_AUTH_SECRET: "test-better-auth-secret",
        BETTER_AUTH_URL: "http://localhost:4545",
        MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
        ONEQUERY_RUNTIME_ROOT: runtimeRoot,
        ONEQUERY_WEB_DIST_DIR: "runtime/web",
        ONEQUERY_SELF_HOST_DATA_DIR: "/tmp/onequery-data/onequery",
        WEB_URL: "http://localhost:4545",
      },
      selfHostPaths: {
        backupsDir: "/tmp/onequery-data/onequery/backups",
        configDir: "/tmp/onequery-config/onequery/self-host",
        dataDir: "/tmp/onequery-data/onequery",
        lockPath: "/tmp/onequery-data/onequery/run/server.lock",
        logsDir: "/tmp/onequery-data/onequery/logs",
        pidPath: "/tmp/onequery-data/onequery/run/server.pid",
        runDir: "/tmp/onequery-data/onequery/run",
        secretsPath: "/tmp/onequery-config/onequery/self-host/secrets.toml",
        configPath: "/tmp/onequery-config/onequery/self-host/config.toml",
        serverLogPath: "/tmp/onequery-data/onequery/logs/server.log",
        pgliteDir: "/tmp/onequery-data/onequery/pglite/onequery",
      },
    });

    const response = await runtime.env.SPA_ASSETS.fetch(
      new Request("http://localhost:4545/")
    );

    await expect(response.text()).resolves.toContain("rooted spa");
  });

  it("loads auth, public origin, and SMTP settings from self-host TOML config", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-runtime-config-"));
    const configDir = join(root, "config", "self-host");
    const dataDir = join(root, "data");
    const assetDir = createTempSpaBuildDir();
    mkdirSync(configDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.toml"),
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
      join(configDir, "secrets.toml"),
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

    const runtime = createRuntimeConfig({
      processEnv: {
        ONEQUERY_WEB_DIST_DIR: assetDir,
        ONEQUERY_SELF_HOST_CONFIG_DIR: configDir,
        ONEQUERY_SELF_HOST_DATA_DIR: dataDir,
      },
      selfHostPaths: {
        backupsDir: join(dataDir, "backups"),
        configDir,
        dataDir,
        lockPath: join(dataDir, "run", "server.lock"),
        logsDir: join(dataDir, "logs"),
        pidPath: join(dataDir, "run", "server.pid"),
        runDir: join(dataDir, "run"),
        secretsPath: join(configDir, "secrets.toml"),
        configPath: join(configDir, "config.toml"),
        serverLogPath: join(dataDir, "logs", "server.log"),
        pgliteDir: join(dataDir, "pglite", "onequery"),
      },
    });

    expect(runtime.listenHost).toBe("127.0.0.1");
    expect(runtime.port).toBe(4848);
    expect(runtime.env.BETTER_AUTH_SECRET).toBe("secret-from-file");
    expect(runtime.env.BETTER_AUTH_URL).toBe("https://onequery.example.com");
    expect(runtime.env.WEB_URL).toBe("https://onequery.example.com");
    expect(runtime.env.SMTP_HOST).toBe("smtp.example.com");
    expect(runtime.env.SMTP_PORT).toBe("587");
    expect(runtime.env.SMTP_FROM_EMAIL).toBe("hello@example.com");
    expect(runtime.env.SMTP_FROM_NAME).toBe("OneQuery OSS");
    expect(runtime.env.SMTP_USERNAME).toBe("smtp-user");
    expect(runtime.env.SMTP_PASSWORD).toBe("smtp-pass-from-file");
  });

  it("rejects invalid PORT values with junk suffixes", () => {
    const assetDir = createTempSpaBuildDir();

    expect(() =>
      createRuntimeConfig({
        processEnv: {
          BETTER_AUTH_SECRET: "test-better-auth-secret",
          BETTER_AUTH_URL: "http://localhost:4545",
          MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
          PORT: "4545abc",
          ONEQUERY_WEB_DIST_DIR: assetDir,
          ONEQUERY_SELF_HOST_DATA_DIR: "/tmp/onequery-data/onequery",
          WEB_URL: "http://localhost:4545",
        },
        selfHostPaths: {
          backupsDir: "/tmp/onequery-data/onequery/backups",
          configDir: "/tmp/onequery-config/onequery/self-host",
          dataDir: "/tmp/onequery-data/onequery",
          lockPath: "/tmp/onequery-data/onequery/run/server.lock",
          logsDir: "/tmp/onequery-data/onequery/logs",
          pidPath: "/tmp/onequery-data/onequery/run/server.pid",
          runDir: "/tmp/onequery-data/onequery/run",
          secretsPath: "/tmp/onequery-config/onequery/self-host/secrets.toml",
          configPath: "/tmp/onequery-config/onequery/self-host/config.toml",
          serverLogPath: "/tmp/onequery-data/onequery/logs/server.log",
          pgliteDir: "/tmp/onequery-data/onequery/pglite/onequery",
        },
      })
    ).toThrow("Invalid PORT value: 4545abc");
  });
});
