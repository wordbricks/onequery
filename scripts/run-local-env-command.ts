import { spawnSync } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  projectDockerComposeConfig,
  projectDrizzleConfig,
  resolveWorkspaceDev,
} from "@onequery/config";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type ParsedArgs = {
  command: string;
  commandArgs: string[];
  cwd: string;
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

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let cwd = process.cwd();

  if (args[0] === "--cwd") {
    const requestedCwd = args[1];
    if (!requestedCwd) {
      throw new Error("--cwd requires a directory value");
    }

    cwd = resolve(rootDir, requestedCwd);
    args.splice(0, 2);
  }

  if (args[0] === "--") {
    args.shift();
  }

  const command = args.shift();
  if (!command) {
    throw new Error("Missing command. Example: bun run db:migrate");
  }

  return {
    command,
    commandArgs: args,
    cwd,
  };
}

function main(): void {
  const { command, commandArgs, cwd } = parseArgs(process.argv.slice(2));
  const workspaceDev = resolveWorkspaceDev({
    rootDir,
  });
  const drizzle = projectDrizzleConfig(workspaceDev);
  const docker = projectDockerComposeConfig(workspaceDev);
  const env = {
    ...process.env,
    DATABASE_URL: drizzle.databaseUrl,
    ONEQUERY_POSTGRES_CONTAINER_PORT: String(docker.postgres.containerPort),
    ONEQUERY_POSTGRES_DB: docker.environment.POSTGRES_DB,
    ONEQUERY_POSTGRES_HOST_PORT: String(docker.postgres.hostPort),
    ONEQUERY_POSTGRES_PASSWORD: docker.environment.POSTGRES_PASSWORD,
    ONEQUERY_POSTGRES_USER: docker.environment.POSTGRES_USER,
    // Child commands like drizzle-kit often live in the target package's local
    // node_modules/.bin rather than the workspace root.
    PATH: prependPathEntries(
      [join(cwd, "node_modules/.bin"), join(rootDir, "node_modules/.bin")],
      process.env.PATH
    ),
  };
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to start ${command}: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main();
