import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WORKSPACE_DEV_CONFIG_FILENAME, WORKSPACE_DEV_SECRETS_FILENAME } from "./workspace-dev";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRootDir = resolve(packageDir, "../..");
const packageJsonPath = resolve(packageDir, "package.json");

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-config-package-surface-"));
}

function writeWorkspaceDevFixture(rootDir: string): void {
  writeFileSync(
    join(rootDir, WORKSPACE_DEV_CONFIG_FILENAME),
    readFileSync(join(repoRootDir, WORKSPACE_DEV_CONFIG_FILENAME), "utf8"),
    "utf8"
  );
  writeFileSync(
    join(rootDir, WORKSPACE_DEV_SECRETS_FILENAME),
    [
      "[auth]",
      'secret = "workspace-auth-secret"',
      "",
      "[crypto]",
      'master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="',
      "",
      "[connectors]",
      'enrollment_token = "connector-token"',
      "",
    ].join("\n"),
    "utf8"
  );
}

describe("@onequery/config package surface", () => {
  it("keeps workspace-dev on one runtime target across resolver conditions", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    expect(packageJson.exports["./workspace-dev"]).toMatchObject({
      bun: "./src/workspace-dev.ts",
      default: "./src/workspace-dev.ts",
    });
  });

  it("resolves workspace-dev the same way through the package surface", async () => {
    const rootDir = createTempRootDir();

    try {
      writeWorkspaceDevFixture(rootDir);

      const packageModule = await import("@onequery/config/workspace-dev");
      const sourceModule = await import("./workspace-dev");

      expect(packageModule.resolveWorkspaceDev({ rootDir })).toEqual(
        sourceModule.resolveWorkspaceDev({ rootDir })
      );
    } finally {
      rmSync(rootDir, {
        force: true,
        recursive: true,
      });
    }
  });
});
