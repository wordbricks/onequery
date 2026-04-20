import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { projectViteDevServerConfig } from "@onequery/config/projections/vite";
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

function captureThrownError(callback: () => unknown): Error {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected callback to throw.");
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

      const workspaceDev = loadWorkspaceDev({ rootDir });

      expect(workspaceDev).toMatchObject({
        api: {
          listen: {
            host: "127.0.0.1",
            port: 4601,
          },
          origin: "http://127.0.0.1:4601",
        },
        auth: {
          secret: "workspace-auth-secret",
        },
        browser: {
          origin: "http://127.0.0.1:4600",
        },
        connectors: {
          enrollmentToken: "workspace-connector-token",
        },
        crypto: {
          masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
        },
        postgres: {
          host: "localhost",
          portBinding: "6500:5433",
          url: "postgres://workspace:secret@localhost:6500/workspace",
        },
        profile: "workspace-dev",
        publicOrigin: "http://127.0.0.1:4600",
      });
      expect(loadViteDevServerConfig({ rootDir })).toEqual(
        projectViteDevServerConfig(workspaceDev)
      );
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

      const error = captureThrownError(() => loadWorkspaceDev({ rootDir }));

      expect(error.message).toContain("Invalid workspace-dev config.");
      expect(error.message).toContain(
        `Config file: ${join(rootDir, WORKSPACE_DEV_CONFIG_FILENAME)}`
      );
      expect(error.message).toContain(
        `Secrets file: ${join(rootDir, WORKSPACE_DEV_SECRETS_FILENAME)}`
      );
      expect(error.message).toContain("config.browser");
      expect(error.message).toContain("secrets.auth");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
