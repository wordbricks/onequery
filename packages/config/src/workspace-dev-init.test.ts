import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureWorkspaceDevSecretsFileSync } from "./workspace-dev-init";
import {
  resolveWorkspaceDev,
  WORKSPACE_DEV_CONFIG_FILENAME,
  WORKSPACE_DEV_SECRETS_FILENAME,
} from "./workspace-dev";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-workspace-dev-init-"));
}

function writeWorkspaceDevConfig(rootDir: string): void {
  writeFileSync(
    join(rootDir, WORKSPACE_DEV_CONFIG_FILENAME),
    ["[browser]", 'host = "localhost"', "port = 4545"].join("\n"),
    "utf8"
  );
}

describe("ensureWorkspaceDevSecretsFileSync", () => {
  it("creates onequery.dev.secrets.toml when missing", () => {
    const rootDir = createTempRootDir();

    try {
      writeWorkspaceDevConfig(rootDir);

      const result = ensureWorkspaceDevSecretsFileSync({
        rootDir,
      });

      expect(result).toEqual({
        created: true,
        path: join(rootDir, WORKSPACE_DEV_SECRETS_FILENAME),
      });

      const contents = readFileSync(result.path, "utf8");
      expect(contents).toContain("[auth]");
      expect(contents).toContain("[crypto]");
      expect(contents).toContain("[connectors]");

      const resolved = resolveWorkspaceDev({
        rootDir,
      });
      expect(resolved.auth.secret).toEqual(expect.any(String));
      expect(resolved.connectors.enrollmentToken).toEqual(expect.any(String));
      expect(resolved.crypto.masterEncryptionKey).toEqual(expect.any(String));
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("keeps an existing secrets file unchanged", () => {
    const rootDir = createTempRootDir();
    const secretsPath = join(rootDir, WORKSPACE_DEV_SECRETS_FILENAME);
    const existingContents = [
      "[auth]",
      'secret = "existing-auth-secret"',
      "",
      "[crypto]",
      'master_encryption_key = "ZXhpc3RpbmctbWFzdGVyLWtleQ=="',
      "",
      "[connectors]",
      'enrollment_token = "existing-enrollment-token"',
      "",
    ].join("\n");

    try {
      writeWorkspaceDevConfig(rootDir);
      writeFileSync(secretsPath, existingContents, "utf8");

      expect(
        ensureWorkspaceDevSecretsFileSync({
          rootDir,
        })
      ).toEqual({
        created: false,
        path: secretsPath,
      });
      expect(readFileSync(secretsPath, "utf8")).toBe(existingContents);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
