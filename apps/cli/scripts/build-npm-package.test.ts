// Comment: this test uses Bun's runner APIs directly; Vitest cannot resolve
// the `bun:test` import.
import { describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __internal, tarballNameForPackage } from "./build-npm-package.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");
const SERVER_PACKAGE_MANIFEST_PATH = path.join(
  WORKSPACE_ROOT,
  "packages",
  "server",
  "package.json"
);

describe("build-npm-package runtime asset resolution", () => {
  it("uses stable filenames for standalone installer bundles", () => {
    expect(tarballNameForPackage("cli-install-darwin-arm64", "1.2.3")).toBe(
      "onequery-install-darwin-arm64.tgz"
    );
  });

  it("anchors sqlParser assets to the declared owner package manifest", async () => {
    const sourcePaths =
      await __internal.resolveRuntimeAssetSourcePaths("sqlParser");
    const serverRequire = createRequire(SERVER_PACKAGE_MANIFEST_PATH);

    expect(sourcePaths).toEqual([
      {
        filename: "sql_parser_wasm_bg.wasm",
        sourcePath: serverRequire.resolve(
          "@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm"
        ),
      },
    ]);
  });

  it("fails clearly when a workspace package is missing", async () => {
    try {
      await __internal.resolveWorkspacePackageRequire(
        "@onequery/not-a-package"
      );
      throw new Error("expected missing workspace package lookup to fail");
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      expect(error.message).toContain(
        "Workspace package '@onequery/not-a-package' was not found in the manifests declared by"
      );
    }
  });

  it("rejects duplicate workspace package names when indexing manifests", () => {
    expect(() =>
      __internal.indexWorkspacePackageManifestPaths([
        {
          name: "@onequery/server",
          packageJsonPath: "/tmp/workspace-a/package.json",
        },
        {
          name: "@onequery/server",
          packageJsonPath: "/tmp/workspace-b/package.json",
        },
      ])
    ).toThrow(
      "Duplicate workspace package name '@onequery/server' in '/tmp/workspace-a/package.json' and '/tmp/workspace-b/package.json'."
    );
  });

  it("restores executable bits for packaged unix vendor binaries", async () => {
    const stagingDir = await mkdtemp(path.join(tmpdir(), "onequery-vendor-"));

    try {
      const targetRoot = path.join(
        stagingDir,
        "vendor",
        "x86_64-unknown-linux-musl"
      );
      const executablePaths = [path.join(targetRoot, "onequery", "onequery")];

      await Promise.all(
        executablePaths.map(async (executablePath) => {
          await mkdir(path.dirname(executablePath), { recursive: true });
          await writeFile(executablePath, "placeholder");
          await chmod(executablePath, 0o644);
        })
      );

      await __internal.restorePackagedExecutableModes({
        targetRoot,
        targetTriple: "x86_64-unknown-linux-musl",
      });

      const executableModes = await Promise.all(
        executablePaths.map(async (executablePath) => {
          const fileStat = await stat(executablePath);
          return fileStat.mode & 0o777;
        })
      );

      expect(executableModes).toEqual([0o755]);
    } finally {
      await rm(stagingDir, { force: true, recursive: true });
    }
  });
});
