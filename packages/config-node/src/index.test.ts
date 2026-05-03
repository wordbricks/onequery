import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { projectViteDevServerConfig } from "@onequery/config/projections/vite";
import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";
import { WORKSPACE_DEV_SECRETS_FILENAME } from "@onequery/config/workspace-dev";
import { describe, expect, it } from "vitest";

import { loadViteDevServerConfig, loadWorkspaceDev } from "./index";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-config-node-"));
}

function writeToml(
  rootDir: string,
  pathSegments: readonly string[],
  lines: readonly string[]
): void {
  const path = join(rootDir, ...pathSegments);
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
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
      writeToml(
        rootDir,
        [".onequery", "dev", WORKSPACE_DEV_SECRETS_FILENAME],
        [
          "[auth]",
          'secret = "workspace-auth-secret"',
          "",
          "[crypto]",
          `master_encryption_key = "${SAMPLE_MASTER_ENCRYPTION_KEY}"`,
          "",
          "[connectors]",
          'enrollment_token = "workspace-connector-token"',
        ]
      );

      const workspaceDev = loadWorkspaceDev({ rootDir });

      expect(workspaceDev).toMatchObject({
        api: {
          listen: {
            host: "127.0.0.1",
            port: 4555,
          },
          origin: "http://127.0.0.1:4555",
        },
        auth: {
          secret: "workspace-auth-secret",
        },
        browser: {
          origin: "http://localhost:4545",
        },
        connectors: {
          enrollmentToken: "workspace-connector-token",
        },
        crypto: {
          masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
        },
        profile: "workspace-dev",
        publicOrigin: "http://localhost:4545",
      });
      expect(loadViteDevServerConfig({ rootDir })).toEqual(
        projectViteDevServerConfig(workspaceDev)
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("renders file-backed validation errors with explicit local profile paths", () => {
    const rootDir = createTempRootDir();

    try {
      const error = captureThrownError(() => loadWorkspaceDev({ rootDir }));

      expect(error.message).toContain("Invalid workspace-dev config.");
      expect(error.message).toContain(
        `Profile dir: ${join(rootDir, ".onequery", "dev")}`
      );
      expect(error.message).toContain(
        `Secrets file: ${join(rootDir, ".onequery", "dev", WORKSPACE_DEV_SECRETS_FILENAME)}`
      );
      expect(error.message).toContain("secrets.auth");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
