import { spawn } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalProcessEnv } from "@onequery/dev-config/local-env";
import { loadLocalDevRuntimeSync } from "@onequery/dev-config/runtime";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bunServerDir = resolve(rootDir, "packages", "bun-server");

type RunMode = "dev" | "local";

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

function parseRunMode(argv: readonly string[]): RunMode {
  const modeFlag = argv[0];

  if (modeFlag === "--dev") {
    return "dev";
  }

  if (modeFlag === "--local" || modeFlag === undefined) {
    return "local";
  }

  throw new Error(
    `Unknown mode: ${modeFlag}. Use --local or --dev when running scripts/run-bun-server.ts.`
  );
}

function createChildEnv(mode: RunMode): NodeJS.ProcessEnv {
  // Comment: Self-host mode should inherit only the caller's explicit process
  // env, not the workspace-dev projection generated from repo config.
  const baseEnv: NodeJS.ProcessEnv =
    mode === "dev" ? createLocalProcessEnv(rootDir) : process.env;
  const childEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    ONEQUERY_RUNTIME_ROOT: rootDir,
    PATH: prependPathEntries(
      [
        join(bunServerDir, "node_modules/.bin"),
        join(rootDir, "node_modules/.bin"),
      ],
      baseEnv.PATH
    ),
  };

  if (mode === "dev") {
    const runtime = loadLocalDevRuntimeSync({
      env: baseEnv,
      rootDir,
    });
    childEnv.BETTER_AUTH_URL = runtime.auth.origin;
    childEnv.DATABASE_URL = runtime.database.development.url;
    childEnv.HOST = runtime.api.host;
    childEnv.PORT = String(runtime.api.port);
    childEnv.WEB_URL = runtime.web.origin;
  }

  return childEnv;
}

function createBunArgs(mode: RunMode): string[] {
  if (mode === "dev") {
    return ["--watch", "src/index.ts"];
  }

  return ["src/index.ts"];
}

function main(): void {
  const mode = parseRunMode(process.argv.slice(2));
  const child = spawn("bun", createBunArgs(mode), {
    cwd: bunServerDir,
    env: createChildEnv(mode),
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
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(`Failed to start bun-server (${mode}): ${error.message}`);
    process.exit(1);
  });
}

main();
