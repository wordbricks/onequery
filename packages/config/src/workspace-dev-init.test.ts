import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceDev,
  WORKSPACE_DEV_CONFIG_FILENAME,
  WORKSPACE_DEV_SECRETS_FILENAME,
} from "./workspace-dev";
import { ensureWorkspaceDevSecretsFileSync } from "./workspace-dev-init";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-workspace-dev-init-"));
}

function writeWorkspaceDevConfig(rootDir: string): void {
  const repoRootDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );

  writeFileSync(
    join(rootDir, WORKSPACE_DEV_CONFIG_FILENAME),
    readFileSync(join(repoRootDir, WORKSPACE_DEV_CONFIG_FILENAME), "utf8"),
    "utf8"
  );
}

function normalizeWorkspaceDevSecretsFile(contents: string): string {
  return contents
    .replace(/secret = "[^"]+"/, 'secret = "<generated-auth-secret>"')
    .replace(
      /master_encryption_key = "[^"]+"/,
      'master_encryption_key = "<generated-master-encryption-key>"'
    )
    .replace(
      /enrollment_token = "[^"]+"/,
      'enrollment_token = "<generated-enrollment-token>"'
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

      const contents = readFileSync(result.path, "utf8");
      expect({
        contents: normalizeWorkspaceDevSecretsFile(contents),
        result: {
          ...result,
          path: result.path.replace(rootDir, "<rootDir>"),
        },
      }).toMatchSnapshot();

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
