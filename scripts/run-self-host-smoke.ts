import { spawn } from "node:child_process";
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

import {
  binaryNameForPlatform,
  resolveTargetTriple,
} from "../apps/cli/bin/package-constants.js";
import { buildServerExecutables } from "../apps/cli/scripts/build-server-executable.js";
import { stagePackagedRuntime } from "../apps/cli/scripts/build-npm-package.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliManifestPath = join(rootDir, "apps", "cli", "Cargo.toml");
const cliBinaryName = binaryNameForPlatform(process.platform, "onequery");
const targetTriple = resolveTargetTriple(process.platform, process.arch);

function resolveCargoBinaryPath(): string {
  const targetDir = process.env.CARGO_TARGET_DIR
    ? resolve(process.env.CARGO_TARGET_DIR)
    : join(rootDir, "apps", "cli", "target");

  return join(targetDir, "debug", cliBinaryName);
}

function buildCliBinary(): string {
  const result = Bun.spawnSync(
    ["cargo", "build", "--manifest-path", cliManifestPath, "--bin", "onequery"],
    {
      cwd: rootDir,
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

async function createStagedBundleRoot(): Promise<string> {
  const stagingRoot = mkdtempSync(join(tmpdir(), "onequery-self-host-smoke-"));
  const bundleRoot = join(stagingRoot, "vendor", targetTriple);
  const cliDir = join(bundleRoot, "onequery");
  const serverDir = join(bundleRoot, "server");
  const stagedCliPath = join(cliDir, cliBinaryName);

  mkdirSync(cliDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });

  copyFileSync(buildCliBinary(), stagedCliPath);
  if (process.platform !== "win32") {
    chmodSync(stagedCliPath, 0o755);
  }

  await Promise.all([
    buildServerExecutables({
      outdir: serverDir,
      targetTriple,
    }),
    stagePackagedRuntime({
      runtimeRoot: bundleRoot,
    }),
  ]);

  return stagingRoot;
}

function cleanup(path: string): void {
  rmSync(path, {
    force: true,
    recursive: true,
  });
}

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  const stagingRoot = await createStagedBundleRoot();
  const bundleRoot = join(stagingRoot, "vendor", targetTriple);
  const stagedCliPath = join(bundleRoot, "onequery", cliBinaryName);
  const child = spawn(stagedCliPath, cliArgs, {
    cwd: rootDir,
    env: {
      ...process.env,
      ONEQUERY_PGLITE_ASSET_DIR:
        process.env.ONEQUERY_PGLITE_ASSET_DIR ??
        join(bundleRoot, "runtime", "pglite"),
      ONEQUERY_RUNTIME_ROOT:
        process.env.ONEQUERY_RUNTIME_ROOT ?? bundleRoot,
    },
    stdio: "inherit",
  });

  const removeStagingRoot = () => cleanup(stagingRoot);

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on("error", (error) => {
    removeStagingRoot();
    console.error(error);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    removeStagingRoot();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

await main();
