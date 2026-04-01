import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  WORKSPACE_DEV_CONFIG_FILENAME,
  WORKSPACE_DEV_SECRETS_FILENAME,
} from "@onequery/config";
import { describe, expect, it } from "vitest";

import { resolveViteDevServerConfig } from "@/lib/vite-dev-server-config";

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
  it("projects a full valid workspace-dev fixture through the wrapper", () => {
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

      expect(resolveViteDevServerConfig({ rootDir })).toEqual({
        apiProxyTarget: "http://127.0.0.1:4601",
        port: 4600,
      });
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
