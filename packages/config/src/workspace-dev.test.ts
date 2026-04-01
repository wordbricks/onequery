import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { projectDockerComposeConfig } from "./projections/docker";
import { projectDrizzleConfig } from "./projections/drizzle";
import { projectWorkspaceDevServerLaunchConfig } from "./projections/server-launch";
import { projectViteDevServerConfig } from "./projections/vite";
import { deriveTestProfile } from "./test-profile";
import {
  resolveWorkspaceDev,
  WORKSPACE_DEV_CONFIG_FILENAME,
  WORKSPACE_DEV_SECRETS_FILENAME,
} from "./workspace-dev";

const repoRootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-config-"));
}

function writeToml(
  rootDir: string,
  filename: string,
  lines: readonly string[]
): void {
  writeFileSync(join(rootDir, filename), `${lines.join("\n")}\n`, "utf8");
}

function writeTrackedWorkspaceDevConfig(rootDir: string): void {
  writeFileSync(
    join(rootDir, WORKSPACE_DEV_CONFIG_FILENAME),
    readFileSync(join(repoRootDir, WORKSPACE_DEV_CONFIG_FILENAME), "utf8"),
    "utf8"
  );
}

describe("@onequery/config workspace-dev", () => {
  it("resolves workspace-dev values from the tracked dev config file", () => {
    const rootDir = createTempRootDir();

    try {
      writeTrackedWorkspaceDevConfig(rootDir);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(resolveWorkspaceDev({ rootDir })).toEqual({
        api: {
          host: "127.0.0.1",
          listen: {
            host: "127.0.0.1",
            port: 4555,
          },
          origin: "http://127.0.0.1:4555",
          port: 4555,
        },
        auth: {
          secret: "better-auth-secret",
        },
        browser: {
          host: "localhost",
          origin: "http://localhost:4545",
          port: 4545,
        },
        connectors: {
          enrollmentToken: "connector-token",
        },
        crypto: {
          masterEncryptionKey:
            "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        },
        flags: {
          disableRateLimit: true,
        },
        paths: {
          configPath: join(rootDir, WORKSPACE_DEV_CONFIG_FILENAME),
          rootDir,
          secretsPath: join(rootDir, WORKSPACE_DEV_SECRETS_FILENAME),
        },
        postgres: {
          containerPort: 5432,
          database: "onequery",
          host: "localhost",
          hostPort: 5454,
          password: "onequery",
          portBinding: "5454:5432",
          url: "postgres://onequery:onequery@localhost:5454/onequery",
          user: "onequery",
        },
        profile: "workspace-dev",
        publicOrigin: "http://localhost:4545",
      });
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("merges public config overrides and produces projections", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
        "[browser]",
        'host = "127.0.0.1"',
        "port = 4600",
        "",
        "[api]",
        'host = "127.0.0.1"',
        "port = 4601",
        "",
        "[postgres]",
        "host_port = 6500",
        "container_port = 5433",
        'database = "workspace"',
        'user = "workspace"',
        'password = "secret"',
        "",
        "[flags]",
        "disable_rate_limit = false",
      ]);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "workspace-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "custom-master-key"',
        "",
        "[connectors]",
        'enrollment_token = "workspace-connector-token"',
      ]);

      const workspaceDev = resolveWorkspaceDev({ rootDir });

      expect(projectViteDevServerConfig(workspaceDev)).toEqual({
        apiProxyTarget: "http://127.0.0.1:4601",
        port: 4600,
      });
      expect(projectDrizzleConfig(workspaceDev)).toEqual({
        databaseUrl: "postgres://workspace:secret@localhost:6500/workspace",
      });
      expect(projectDockerComposeConfig(workspaceDev)).toEqual({
        environment: {
          POSTGRES_DB: "workspace",
          POSTGRES_PASSWORD: "secret",
          POSTGRES_USER: "workspace",
        },
        postgres: {
          containerPort: 5433,
          hostPort: 6500,
          portBinding: "6500:5433",
        },
      });
      expect(
        projectWorkspaceDevServerLaunchConfig(workspaceDev, {
          assetDir: "/tmp/workspace-web",
        })
      ).toEqual({
        assets: {
          distDir: "/tmp/workspace-web",
        },
        auth: {
          secret: "workspace-auth-secret",
        },
        connectors: {
          enrollmentToken: "workspace-connector-token",
        },
        crypto: {
          masterEncryptionKey: "custom-master-key",
        },
        listen: {
          host: "127.0.0.1",
          port: 4601,
        },
        mode: "workspace-dev",
        publicOrigin: "http://127.0.0.1:4600",
        rateLimit: {
          enabled: true,
          storage: "memory",
        },
        storage: {
          kind: "postgres",
          url: "postgres://workspace:secret@localhost:6500/workspace",
        },
      });
      expect(deriveTestProfile(workspaceDev)).toEqual({
        database: {
          database: "test",
          host: "localhost",
          password: "test",
          port: 6500,
          url: "postgres://test:test@localhost:6500/test",
          user: "test",
        },
        profile: "test",
      });
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects missing secrets", () => {
    const rootDir = createTempRootDir();

    try {
      writeTrackedWorkspaceDevConfig(rootDir);
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow(
        "Invalid workspace-dev config."
      );
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("auth");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects duplicate host ports", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
        "[browser]",
        'host = "localhost"',
        "port = 4545",
        "",
        "[api]",
        'host = "127.0.0.1"',
        "port = 4545",
        "",
        "[postgres]",
        "host_port = 5454",
        "container_port = 5432",
        'database = "onequery"',
        'user = "onequery"',
        'password = "onequery"',
        "",
        "[flags]",
        "disable_rate_limit = true",
      ]);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow(
        'Workspace-dev host ports must be unique. "api.port" conflicts with "browser.port" on 4545.'
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects unknown keys in the config file", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
        "[browser]",
        'host = "localhost"',
        "port = 4545",
        'extra = "nope"',
        "",
        "[api]",
        'host = "127.0.0.1"',
        "port = 4555",
        "",
        "[postgres]",
        "host_port = 5454",
        "container_port = 5432",
        'database = "onequery"',
        'user = "onequery"',
        'password = "onequery"',
        "",
        "[flags]",
        "disable_rate_limit = true",
      ]);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("extra");
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("Config:");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects unknown keys in the secrets file", () => {
    const rootDir = createTempRootDir();

    try {
      writeTrackedWorkspaceDevConfig(rootDir);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        'unexpected = "nope"',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("unexpected");
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("Secrets:");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects secret keys in the config file", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
        "[browser]",
        'host = "localhost"',
        "port = 4545",
        "",
        "[api]",
        'host = "127.0.0.1"',
        "port = 4555",
        "",
        "[postgres]",
        "host_port = 5454",
        "container_port = 5432",
        'database = "onequery"',
        'user = "onequery"',
        'password = "onequery"',
        "",
        "[flags]",
        "disable_rate_limit = true",
        "",
        "[auth]",
        'secret = "wrong-file"',
      ]);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("auth");
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("Config:");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects config keys in the secrets file", () => {
    const rootDir = createTempRootDir();

    try {
      writeTrackedWorkspaceDevConfig(rootDir);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
        "",
        "[browser]",
        "port = 4545",
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("browser");
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("Secrets:");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects misspelled nested keys in the config file", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
        "[browser]",
        'host = "localhost"',
        "prt = 4545",
        "",
        "[api]",
        'host = "127.0.0.1"',
        "port = 4555",
        "",
        "[postgres]",
        "host_port = 5454",
        "container_port = 5432",
        'database = "onequery"',
        'user = "onequery"',
        'password = "onequery"',
        "",
        "[flags]",
        "disable_rate_limit = true",
      ]);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("prt");
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("browser.port");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects a missing tracked dev config file", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow(
        "Invalid workspace-dev config."
      );
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("browser");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects an incomplete tracked dev config file", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
        "[api]",
        'host = "127.0.0.1"',
        "port = 4555",
        "",
        "[postgres]",
        "host_port = 5454",
        "container_port = 5432",
        'database = "onequery"',
        'user = "onequery"',
        'password = "onequery"',
        "",
        "[flags]",
        "disable_rate_limit = true",
      ]);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "better-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
        "",
        "[connectors]",
        'enrollment_token = "connector-token"',
      ]);

      expect(() => resolveWorkspaceDev({ rootDir })).toThrow(
        "Invalid workspace-dev config."
      );
      expect(() => resolveWorkspaceDev({ rootDir })).toThrow("browser");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
