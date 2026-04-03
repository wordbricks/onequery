import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __internal } from "./build-npm-package.js";

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

  it("finds the owning workspace package manifest by package name", async () => {
    expect(
      await __internal.resolveWorkspacePackageManifestPath("@onequery/server")
    ).toBe(SERVER_PACKAGE_MANIFEST_PATH);
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
});
