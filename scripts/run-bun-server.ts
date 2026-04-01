import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDefaultSpaBuildDir } from "@onequery/bun-server/assets";
import { projectWorkspaceDevServerLaunchConfig } from "@onequery/config/projections/server-launch";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { resolveWorkspaceDev } from "@onequery/config/workspace-dev";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bunServerDir = resolve(rootDir, "packages", "bun-server");

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
    `Unknown mode: ${modeFlag}. Use --dev when running scripts/run-bun-server.ts.`
  );
}

export function createLaunchConfig(
  configRootDir: string = rootDir
): ServerLaunchConfig {
  return projectWorkspaceDevServerLaunchConfig(
    resolveWorkspaceDev({
      rootDir: configRootDir,
    }),
    {
      assetDir: getDefaultSpaBuildDir(configRootDir),
    }
  );
}

export function writeLaunchConfigFile(launchConfig: ServerLaunchConfig): {
  launchConfigPath: string;
  tempDir: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "onequery-bun-server-"));
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
        join(bunServerDir, "node_modules/.bin"),
        join(rootDir, "node_modules/.bin"),
      ],
      process.env.PATH
    ),
  };

  return childEnv;
}

export function createBunArgs(launchConfigPath: string): string[] {
  return ["--watch", "src/index.ts", launchConfigPath];
}

export function main(): void {
  parseRunMode(process.argv.slice(2));
  const launchConfig = writeLaunchConfigFile(createLaunchConfig());
  const child = spawn("bun", createBunArgs(launchConfig.launchConfigPath), {
    cwd: bunServerDir,
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
    console.error(`Failed to start bun-server (dev): ${error.message}`);
    process.exit(1);
  });
}

if (import.meta.main) {
  main();
}
