import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePackagedRuntimeAssetPath } from "@onequery/base/runtime-bundle";
import { viewServerLaunchConfig } from "@onequery/config/server-launch";
import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  createChildEnv,
  createLaunchConfig,
  createWorkspaceDevRuntimeRoot,
  stageWorkspaceDevRuntimeAssetsResult,
} from "../../../scripts/run-self-host-runtime";

const stagedRoots = new Set<string>();

afterEach(() => {
  for (const rootDir of stagedRoots) {
    rmSync(rootDir, { force: true, recursive: true });
  }
  stagedRoots.clear();
});

describe("self-host runtime dev entrypoint", () => {
  it("writes a launch contract with separate browser and API ports", () => {
    const rootDir = mkdtempSync(
      join(tmpdir(), "onequery-self-host-runtime-dev-entrypoint-")
    );

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
      const launchView = viewServerLaunchConfig(launchConfig, "test");
      const listen = launchView.common.listen;
      if (listen === undefined) {
        throw new Error("expected launch config listen settings");
      }

      expect(launchView.mode).toBe("workspace-dev");
      expect(listen).toMatchObject({
        host: "127.0.0.1",
        port: 4555,
      });
      expect(launchView.common.publicOrigin).toBe("http://localhost:4545");
      expect(listen.port).not.toBe(
        Number.parseInt(new URL(launchView.common.publicOrigin).port, 10)
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("stages workspace-dev runtime sidecar assets for the bundled Node entry", async () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), "onequery-self-host-runtime-dev-assets-")
    );
    stagedRoots.add(tempDir);
    const runtimeRoot = createWorkspaceDevRuntimeRoot(tempDir);

    const result = await stageWorkspaceDevRuntimeAssetsResult(runtimeRoot);

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      throw result.error;
    }
    expect(createChildEnv({ runtimeRoot }).ONEQUERY_RUNTIME_ROOT).toBe(
      runtimeRoot
    );
    expect(
      existsSync(
        resolvePackagedRuntimeAssetPath(runtimeRoot, "sqlParser", "wasm")
      )
    ).toBe(true);
    expect(
      existsSync(
        resolvePackagedRuntimeAssetPath(runtimeRoot, "pglite", "pgliteWasm")
      )
    ).toBe(true);
  });
});
