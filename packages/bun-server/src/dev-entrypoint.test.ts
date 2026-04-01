import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";

import { createLaunchConfig } from "../../../scripts/run-bun-server";

describe("bun dev entrypoint", () => {
  it("writes a launch contract with separate browser and API ports", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "onequery-bun-dev-entrypoint-"));

    try {
      writeFileSync(
        join(rootDir, "onequery.dev.toml"),
        [
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
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        join(rootDir, "onequery.dev.secrets.toml"),
        [
          "[auth]",
          'secret = "workspace-auth-secret"',
          "",
          "[crypto]",
          `master_encryption_key = "${SAMPLE_MASTER_ENCRYPTION_KEY}"`,
          "",
          "[connectors]",
          'enrollment_token = "connector-token"',
        ].join("\n"),
        "utf8"
      );

      const launchConfig = createLaunchConfig(rootDir);

      expect(launchConfig.mode).toBe("workspace-dev");
      expect(launchConfig.listen).toEqual({
        host: "127.0.0.1",
        port: 4555,
      });
      expect(launchConfig.publicOrigin).toBe("http://localhost:4545");
      expect(launchConfig.listen.port).not.toBe(
        Number.parseInt(new URL(launchConfig.publicOrigin).port, 10)
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
