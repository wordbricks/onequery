import { spawnSync } from "node:child_process";
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

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFilePath);

export const cliRootDir = resolve(scriptDir, "..");
const workspaceRootDir = resolve(cliRootDir, "..", "..");
const cliManifestPath = join(cliRootDir, "Cargo.toml");
const cliBinaryName = binaryNameForPlatform(process.platform, "onequery");
const targetTriple = resolveTargetTriple(process.platform, process.arch);

function resolveCargoBinaryPath() {
  const targetDir = process.env.CARGO_TARGET_DIR
    ? resolve(process.env.CARGO_TARGET_DIR)
    : join(workspaceRootDir, "apps", "cli", "target");

  return join(targetDir, "debug", cliBinaryName);
}

function resolveBundledRuntimeRoot(stagingRoot) {
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

function buildCliBinary() {
  const result = spawnSync(
    "cargo",
    ["build", "--manifest-path", cliManifestPath, "--bin", "onequery"],
    {
      cwd: workspaceRootDir,
      stdio: "inherit",
    }
  );

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }

  const binaryPath = resolveCargoBinaryPath();
  if (!existsSync(binaryPath)) {
    throw new Error(`expected built CLI binary at ${binaryPath}`);
  }

  return binaryPath;
}

function buildServerBundleArtifacts({ outdir, targetTriple }) {
  // Comment: local smoke should exercise the same packaging wrapper as release
  // staging so both paths keep using the same Rolldown server bundle.
  const result = spawnSync(
    process.execPath,
    [
      join(cliRootDir, "scripts", "build-server-bundle.js"),
      "--target-triple",
      targetTriple,
      "--outdir",
      outdir,
    ],
    {
      cwd: workspaceRootDir,
      stdio: "inherit",
    }
  );

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
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

  buildServerBundleArtifacts({
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
