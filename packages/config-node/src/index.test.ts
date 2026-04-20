import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";
import {
  WORKSPACE_DEV_CONFIG_FILENAME,
  WORKSPACE_DEV_SECRETS_FILENAME,
} from "@onequery/config/workspace-dev";
import { describe, expect, it } from "vitest";

import { loadViteDevServerConfig, loadWorkspaceDev } from "./index";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-config-node-"));
}

function writeToml(
  rootDir: string,
  filename: string,
  lines: readonly string[]
): void {
  writeFileSync(join(rootDir, filename), `${lines.join("\n")}\n`, "utf8");
}

describe("@onequery/config-node workspace-dev", () => {
  it("loads the workspace-dev config from disk", () => {
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
        `master_encryption_key = "${SAMPLE_MASTER_ENCRYPTION_KEY}"`,
        "",
        "[connectors]",
        'enrollment_token = "workspace-connector-token"',
      ]);

      expect(loadWorkspaceDev({ rootDir })).toEqual({
        api: {
          host: "127.0.0.1",
          listen: {
            host: "127.0.0.1",
            port: 4601,
          },
          origin: "http://127.0.0.1:4601",
          port: 4601,
        },
        auth: {
          secret: "workspace-auth-secret",
        },
        browser: {
          host: "127.0.0.1",
          origin: "http://127.0.0.1:4600",
          port: 4600,
        },
        connectors: {
          enrollmentToken: "workspace-connector-token",
        },
        crypto: {
          masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
        },
        flags: {
          disableRateLimit: false,
        },
        postgres: {
          containerPort: 5433,
          database: "workspace",
          host: "localhost",
          hostPort: 6500,
          password: "secret",
          portBinding: "6500:5433",
          url: "postgres://workspace:secret@localhost:6500/workspace",
          user: "workspace",
        },
        profile: "workspace-dev",
        publicOrigin: "http://127.0.0.1:4600",
      });
      expect(loadViteDevServerConfig({ rootDir })).toEqual({
        apiProxyTarget: "http://127.0.0.1:4601",
        port: 4600,
      });
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("renders file-backed validation errors with explicit config paths", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
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

      expect(() => loadWorkspaceDev({ rootDir })).toThrow(
        "Invalid workspace-dev config."
      );
      expect(() => loadWorkspaceDev({ rootDir })).toThrow(
        `Config file: ${join(rootDir, WORKSPACE_DEV_CONFIG_FILENAME)}`
      );
      expect(() => loadWorkspaceDev({ rootDir })).toThrow(
        `Secrets file: ${join(rootDir, WORKSPACE_DEV_SECRETS_FILENAME)}`
      );
      expect(() => loadWorkspaceDev({ rootDir })).toThrow("config.browser");
      expect(() => loadWorkspaceDev({ rootDir })).toThrow("secrets.auth");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
