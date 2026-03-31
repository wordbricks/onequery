import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveViteDevServerConfig } from "@/lib/vite-dev-server-config";
import {
  WORKSPACE_DEV_CONFIG_FILENAME,
  WORKSPACE_DEV_SECRETS_FILENAME,
} from "@onequery/config";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-web-config-"));
}

function writeToml(
  rootDir: string,
  filename: string,
  lines: readonly string[]
): void {
  writeFileSync(join(rootDir, filename), `${lines.join("\n")}\n`, "utf8");
}

describe("resolveViteDevServerConfig", () => {
  it("reads the default workspace-dev projection", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "test-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "test-master-key"',
        "",
        "[connectors]",
        'enrollment_token = "test-enrollment-token"',
      ]);

      expect(resolveViteDevServerConfig({ rootDir })).toEqual({
        apiProxyTarget: "http://127.0.0.1:4555",
        port: 4545,
      });
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("reads browser and api overrides from onequery.dev.toml", () => {
    const rootDir = createTempRootDir();

    try {
      writeToml(rootDir, WORKSPACE_DEV_CONFIG_FILENAME, [
        "[browser]",
        "port = 4600",
        "",
        "[api]",
        'host = "127.0.0.1"',
        "port = 4601",
      ]);
      writeToml(rootDir, WORKSPACE_DEV_SECRETS_FILENAME, [
        "[auth]",
        'secret = "test-auth-secret"',
        "",
        "[crypto]",
        'master_encryption_key = "test-master-key"',
        "",
        "[connectors]",
        'enrollment_token = "test-enrollment-token"',
      ]);

      expect(resolveViteDevServerConfig({ rootDir })).toEqual({
        apiProxyTarget: "http://127.0.0.1:4601",
        port: 4600,
      });
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
