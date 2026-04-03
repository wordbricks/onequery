import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupPath,
  createBundledRuntimeEnv,
  createStagedBundleRoot,
  resolveBundledRuntimeRoot,
  resolveStagedCliPath,
} from "../apps/cli/scripts/self-host-runtime.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  const stagingRoot = await createStagedBundleRoot();
  const bundleRoot = resolveBundledRuntimeRoot(stagingRoot);
  const stagedCliPath = resolveStagedCliPath(stagingRoot);
  const child = spawn(stagedCliPath, cliArgs, {
    cwd: rootDir,
    env: createBundledRuntimeEnv(stagingRoot),
    stdio: "inherit",
  });

  const removeStagingRoot = () => cleanupPath(stagingRoot);

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
