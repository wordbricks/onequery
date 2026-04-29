import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorkspaceDev } from "@onequery/config-node";
import { projectWorkspaceDevServerLaunchConfig } from "@onequery/config/projections/server-launch";
import { encodeServerLaunchConfigJson } from "@onequery/config/server-launch";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { getDefaultSpaBuildDir } from "@onequery/self-host-runtime/assets";
import {
  renderWorkspaceDevRuntimePreparationError,
  stageWorkspaceDevRuntimeAssetsResult as stageWorkspaceDevRuntimeAssetsWithStager,
  waitForBundledRuntimeResult,
} from "@onequery/self-host-runtime/dev-runner";

import { stageRuntimeAssets } from "../apps/cli/scripts/build-npm-package.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selfHostRuntimeDir = resolve(rootDir, "packages", "self-host-runtime");
const bundledRuntimePath = resolve(selfHostRuntimeDir, "dist", "node-entry.js");

type ChildEnvOptions = {
  runtimeRoot?: string;
};

function prependPathEntries(
  entries: readonly string[],
  currentPath: string | undefined
): string {
  const seen = new Set<string>();
  const merged = [...entries, ...(currentPath?.split(delimiter) ?? [])].filter(
    (entry) => {
      if (!entry || seen.has(entry)) {
        return false;
      }

      seen.add(entry);
      return true;
    }
  );

  return merged.join(delimiter);
}

export function parseRunMode(argv: readonly string[]): "dev" {
  const modeFlag = argv[0];

  if (modeFlag === "--dev" || modeFlag === undefined) {
    return "dev";
  }

  throw new Error(
    `Unknown mode: ${modeFlag}. Use --dev when running scripts/run-self-host-runtime.ts.`
  );
}

export function createLaunchConfig(
  configRootDir: string = rootDir
): ServerLaunchConfig {
  return projectWorkspaceDevServerLaunchConfig(
    loadWorkspaceDev({
      rootDir: configRootDir,
    }),
    {
      assetDir: getDefaultSpaBuildDir(configRootDir),
      migrationsDir: resolve(
        configRootDir,
        "packages",
        "db",
        "src",
        "migrations"
      ),
    }
  );
}

export function writeLaunchConfigFile(launchConfig: ServerLaunchConfig): {
  launchConfigPath: string;
  tempDir: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "onequery-self-host-runtime-"));
  const launchConfigPath = join(tempDir, "launch.json");

  writeFileSync(launchConfigPath, encodeServerLaunchConfigJson(launchConfig));

  return {
    launchConfigPath,
    tempDir,
  };
}

export function createWorkspaceDevRuntimeRoot(tempDir: string): string {
  return join(tempDir, "runtime-root");
}

export async function stageWorkspaceDevRuntimeAssetsResult(
  runtimeRoot: string
): ReturnType<typeof stageWorkspaceDevRuntimeAssetsWithStager> {
  return stageWorkspaceDevRuntimeAssetsWithStager(
    runtimeRoot,
    stageRuntimeAssets
  );
}

export function createChildEnv(
  options: ChildEnvOptions = {}
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ONEQUERY_RUNTIME_ROOT: options.runtimeRoot ?? rootDir,
    PATH: prependPathEntries(
      [
        join(selfHostRuntimeDir, "node_modules/.bin"),
        join(rootDir, "node_modules/.bin"),
      ],
      process.env.PATH
    ),
  };

  return childEnv;
}

export function createRuntimeArgs(launchConfigPath: string): string[] {
  return ["--watch", bundledRuntimePath, launchConfigPath];
}

export function createRuntimeBuildArgs(): string[] {
  // Comment: dev mode still uses Bun for fast incremental bundling, but the
  // launched self-host runtime process itself runs on Node.
  return [
    "build",
    "--target",
    "node",
    "--format",
    "esm",
    "--outfile",
    bundledRuntimePath,
    "--conditions",
    "bun",
    "--watch",
    "src/node-entry.ts",
  ];
}

function terminateChild(
  child: ReturnType<typeof spawn> | null,
  signal: NodeJS.Signals = "SIGTERM"
): void {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

function failBeforeRuntimeStart(tempDir: string, message: string): never {
  rmSync(tempDir, {
    force: true,
    recursive: true,
  });
  console.error(message);
  process.exit(1);
}

export async function main(): Promise<void> {
  parseRunMode(process.argv.slice(2));
  const launchConfig = writeLaunchConfigFile(createLaunchConfig());
  const runtimeRoot = createWorkspaceDevRuntimeRoot(launchConfig.tempDir);
  const runtimeAssets = await stageWorkspaceDevRuntimeAssetsResult(runtimeRoot);
  if (runtimeAssets.isErr()) {
    failBeforeRuntimeStart(
      launchConfig.tempDir,
      renderWorkspaceDevRuntimePreparationError(runtimeAssets.error)
    );
  }

  const buildStartedAtMs = Date.now();
  const builder = spawn("bun", createRuntimeBuildArgs(), {
    cwd: selfHostRuntimeDir,
    env: createChildEnv({ runtimeRoot }),
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  let runtime: ReturnType<typeof spawn> | null = null;
  let finalized = false;

  const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
    if (finalized) {
      return;
    }
    finalized = true;

    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  };

  const forwardSignal = (signal: "SIGINT" | "SIGTERM") => {
    process.on(signal, () => {
      terminateChild(runtime, signal);
      terminateChild(builder, signal);
    });
  };

  forwardSignal("SIGINT");
  forwardSignal("SIGTERM");

  builder.on("exit", (code, signal) => {
    if (finalized) {
      return;
    }

    terminateChild(runtime, signal ?? "SIGTERM");
    finalize(code, signal);
  });

  builder.on("error", (error) => {
    terminateChild(runtime);
    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });
    console.error(
      `Failed to build Node self-host runtime entry: ${error.message}`
    );
    process.exit(1);
  });

  const bundledRuntime = await waitForBundledRuntimeResult({
    buildStartedAtMs,
    builder,
    bundledRuntimePath,
  });
  if (bundledRuntime.isErr()) {
    terminateChild(builder);
    failBeforeRuntimeStart(
      launchConfig.tempDir,
      renderWorkspaceDevRuntimePreparationError(bundledRuntime.error)
    );
  }

  runtime = spawn("node", createRuntimeArgs(launchConfig.launchConfigPath), {
    cwd: selfHostRuntimeDir,
    env: createChildEnv({ runtimeRoot }),
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  runtime.on("exit", (code, signal) => {
    terminateChild(builder, signal ?? "SIGTERM");
    finalize(code, signal);
  });

  runtime.on("error", (error) => {
    terminateChild(builder);
    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });
    console.error(`Failed to start self-host runtime (dev): ${error.message}`);
    process.exit(1);
  });
}

if (import.meta.main) {
  await main();
}
