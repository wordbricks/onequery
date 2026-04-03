import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePackagedRuntimeBundleDirectory } from "@onequery/base/runtime-bundle";

import {
  binaryNameForPlatform,
  resolveTargetTriple,
} from "../bin/package-constants.js";
import { stagePackagedRuntime } from "./build-npm-package.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const cliRootDir = resolve(__dirname, "..");
export const workspaceRootDir = resolve(cliRootDir, "..", "..");
export const cliManifestPath = join(cliRootDir, "Cargo.toml");
export const cliBinaryName = binaryNameForPlatform(
  process.platform,
  "onequery"
);
export const targetTriple = resolveTargetTriple(process.platform, process.arch);

export function resolveCargoBinaryPath() {
  const targetDir = process.env.CARGO_TARGET_DIR
    ? resolve(process.env.CARGO_TARGET_DIR)
    : join(workspaceRootDir, "apps", "cli", "target");

  return join(targetDir, "debug", cliBinaryName);
}

export function resolveBundledRuntimeRoot(stagingRoot) {
  return join(stagingRoot, "vendor", targetTriple);
}

export function resolveStagedCliPath(stagingRoot) {
  return join(
    resolvePackagedRuntimeBundleDirectory(
      resolveBundledRuntimeRoot(stagingRoot),
      "cli"
    ),
    cliBinaryName
  );
}

export function createBundledRuntimeEnv(stagingRoot, env = {}) {
  const bundleRoot = resolveBundledRuntimeRoot(stagingRoot);

  return {
    ...process.env,
    ...env,
    ONEQUERY_RUNTIME_ROOT:
      env.ONEQUERY_RUNTIME_ROOT ??
      process.env.ONEQUERY_RUNTIME_ROOT ??
      bundleRoot,
  };
}

export function buildCliBinary() {
  const result = Bun.spawnSync(
    ["cargo", "build", "--manifest-path", cliManifestPath, "--bin", "onequery"],
    {
      cwd: workspaceRootDir,
      stderr: "inherit",
      stdout: "inherit",
    }
  );

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }

  const binaryPath = resolveCargoBinaryPath();
  if (!existsSync(binaryPath)) {
    throw new Error(`expected built CLI binary at ${binaryPath}`);
  }

  return binaryPath;
}

function buildServerExecutableArtifacts({ outdir, targetTriple }) {
  // Comment: `Bun.build` module resolution is inconsistent when this helper is
  // invoked from `bun test`; shelling out through the existing script keeps the
  // packaged-server build on the same path used by local smoke commands.
  const result = Bun.spawnSync(
    [
      process.execPath,
      join(cliRootDir, "scripts", "build-server-executable.js"),
      "--target-triple",
      targetTriple,
      "--outdir",
      outdir,
    ],
    {
      cwd: workspaceRootDir,
      stderr: "inherit",
      stdout: "inherit",
    }
  );

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

export async function createStagedBundleRoot() {
  const stagingRoot = mkdtempSync(join(tmpdir(), "onequery-self-host-smoke-"));
  const bundleRoot = resolveBundledRuntimeRoot(stagingRoot);
  const cliDir = resolvePackagedRuntimeBundleDirectory(bundleRoot, "cli");
  const serverDir = resolvePackagedRuntimeBundleDirectory(bundleRoot, "server");
  const stagedCliPath = resolveStagedCliPath(stagingRoot);

  mkdirSync(cliDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });

  copyFileSync(buildCliBinary(), stagedCliPath);
  if (process.platform !== "win32") {
    chmodSync(stagedCliPath, 0o755);
  }

  buildServerExecutableArtifacts({
    outdir: serverDir,
    targetTriple,
  });

  await Promise.all([
    stagePackagedRuntime({
      runtimeRoot: bundleRoot,
    }),
  ]);

  return stagingRoot;
}

export function cleanupPath(path) {
  rmSync(path, {
    force: true,
    recursive: true,
  });
}
