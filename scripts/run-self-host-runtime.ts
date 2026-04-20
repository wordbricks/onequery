import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorkspaceDev } from "@onequery/config-node";
import { projectWorkspaceDevServerLaunchConfig } from "@onequery/config/projections/server-launch";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { getDefaultSpaBuildDir } from "@onequery/self-host-runtime/assets";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selfHostRuntimeDir = resolve(rootDir, "packages", "self-host-runtime");

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

  writeFileSync(launchConfigPath, JSON.stringify(launchConfig, null, 2));

  return {
    launchConfigPath,
    tempDir,
  };
}

export function createChildEnv(): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ONEQUERY_RUNTIME_ROOT: rootDir,
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
  return ["--watch", "src/bun-entry.ts", launchConfigPath];
}

export function main(): void {
  parseRunMode(process.argv.slice(2));
  const launchConfig = writeLaunchConfigFile(createLaunchConfig());
  const child = spawn("bun", createRuntimeArgs(launchConfig.launchConfigPath), {
    cwd: selfHostRuntimeDir,
    env: createChildEnv(),
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on("exit", (code, signal) => {
    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });
    console.error(`Failed to start self-host runtime (dev): ${error.message}`);
    process.exit(1);
  });
}

if (import.meta.main) {
  main();
}
