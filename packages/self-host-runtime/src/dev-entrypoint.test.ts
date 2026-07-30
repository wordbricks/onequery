import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePackagedRuntimeAssetPath } from "@onequery/base/runtime-bundle";
import {
  decodeServerLaunchConfigJson,
  viewServerLaunchConfig,
} from "@onequery/config/server-launch";
import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  createChildEnv,
  createLaunchConfig,
  createWorkspaceDevRuntimeRoot,
  stageWorkspaceDevRuntimeAssetsResult,
} from "../../../scripts/run-self-host-runtime";

const selfHostRuntimeDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
const workspaceDevBundleAdjacentPolyglotWasmPath = join(
  selfHostRuntimeDir,
  "dist",
  "polyglot_sql.wasm"
);
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
      mkdirSync(join(rootDir, ".onequery", "dev"), {
        recursive: true,
      });
      writeFileSync(
        join(rootDir, ".onequery", "dev", "secrets.toml"),
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

      const launchConfig = decodeServerLaunchConfigJson(
        JSON.stringify(createLaunchConfig(rootDir)),
        "test"
      );
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
        resolvePackagedRuntimeAssetPath(runtimeRoot, "polyglotSql", "wasm")
      )
    ).toBe(true);
    expect(existsSync(workspaceDevBundleAdjacentPolyglotWasmPath)).toBe(true);
    expect(
      existsSync(
        resolvePackagedRuntimeAssetPath(runtimeRoot, "pglite", "pgliteWasm")
      )
    ).toBe(true);
  });
});
