import { execSync } from "node:child_process";

import {
  deriveTestProfile,
  projectDockerComposeConfig,
} from "@onequery/config";
import type {
  DerivedTestProfile,
  ResolvedWorkspaceDevConfig,
} from "@onequery/config";
import {
  ensureWorkspaceDevSecretsFileSync,
  loadWorkspaceDev,
} from "@onequery/config-node";

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;
const DOCKER_INFO_TIMEOUT_MS = 5000;

type ExecOptions = {
  env?: NodeJS.ProcessEnv;
  silent?: boolean;
  timeoutMs?: number;
};

let workspaceDevCache: ResolvedWorkspaceDevConfig | undefined;
let testProfileCache: DerivedTestProfile | undefined;
let dockerComposeEnvCache: NodeJS.ProcessEnv | undefined;

function getWorkspaceDev(): ResolvedWorkspaceDevConfig {
  if (!workspaceDevCache) {
    workspaceDevCache = loadWorkspaceDev({
      rootDir: process.cwd(),
    });
  }

  return workspaceDevCache;
}

function getTestProfile(): DerivedTestProfile {
  if (!testProfileCache) {
    testProfileCache = deriveTestProfile(getWorkspaceDev());
  }

  return testProfileCache;
}

function getDockerComposeEnv(): NodeJS.ProcessEnv {
  if (!dockerComposeEnvCache) {
    const docker = projectDockerComposeConfig(getWorkspaceDev());

    dockerComposeEnvCache = {
      ...process.env,
      ONEQUERY_POSTGRES_CONTAINER_PORT: String(docker.postgres.containerPort),
      ONEQUERY_POSTGRES_DB: docker.environment.POSTGRES_DB,
      ONEQUERY_POSTGRES_HOST_PORT: String(docker.postgres.hostPort),
      ONEQUERY_POSTGRES_PASSWORD: docker.environment.POSTGRES_PASSWORD,
      ONEQUERY_POSTGRES_USER: docker.environment.POSTGRES_USER,
    };
  }

  return dockerComposeEnvCache;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function exec(command: string, options?: ExecOptions): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
      env: options?.env,
      killSignal: "SIGKILL",
      stdio: options?.silent ? "pipe" : "inherit",
      timeout: options?.timeoutMs,
    });
  } catch (error) {
    if (options?.silent) {
      return "";
    }
    throw error;
  }
}

function execDockerCompose(
  command: string,
  options?: Omit<ExecOptions, "env">
): string {
  return exec(`docker compose ${command}`, {
    ...options,
    env: getDockerComposeEnv(),
  });
}

function isDockerRunning(): boolean {
  try {
    exec("docker info", {
      silent: true,
      timeoutMs: DOCKER_INFO_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

function getCurrentComposePostgresContainerNames(): Set<string> {
  try {
    const result = execDockerCompose("ps --format json", { silent: true });
    const names = new Set<string>();

    for (const line of result.split("\n")) {
      if (!line.trim()) {
        continue;
      }

      const container = JSON.parse(line) as {
        Name?: string;
        Names?: string;
        Service?: string;
      };
      if (container.Service !== "postgres") {
        continue;
      }

      if (container.Name) {
        names.add(container.Name);
      }
      if (container.Names) {
        names.add(container.Names);
      }
    }

    return names;
  } catch {
    return new Set<string>();
  }
}

function stopConflictingPostgres(): void {
  const currentComposePostgresNames = getCurrentComposePostgresContainerNames();

  // Find any running container publishing the configured Postgres host port.
  // Do not hardcode the compose container name here because it changes with the
  // checkout directory.
  const workspaceDev = getWorkspaceDev();
  const result = exec(
    `docker ps --filter "publish=${workspaceDev.postgres.hostPort}" --format "{{.Names}}"`,
    { silent: true }
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (result.length === 0) {
    return;
  }

  for (const containerName of result) {
    if (currentComposePostgresNames.has(containerName)) {
      continue;
    }

    console.log(`Stopping conflicting container: ${containerName}`);
    exec(`docker stop ${containerName}`, { silent: true });
  }
}

function isPostgresHealthy(): boolean {
  try {
    const result = execDockerCompose("ps --format json", { silent: true });
    // Docker outputs one JSON object per line
    for (const line of result.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const container = JSON.parse(line);
      if (container.Service === "postgres" && container.Health === "healthy") {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function waitForPostgres(): Promise<boolean> {
  console.log("Waiting for PostgreSQL to be healthy...");

  for (let i = 0; i < MAX_RETRIES; i++) {
    if (isPostgresHealthy()) {
      console.log("PostgreSQL is healthy!");
      return true;
    }
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  console.log(
    "\nFailed: PostgreSQL did not become healthy after maximum retries."
  );
  return false;
}

function enablePgvector(): void {
  const workspaceDev = getWorkspaceDev();
  console.log(
    `Enabling pgvector extension (${workspaceDev.postgres.database})...`
  );
  enablePgvectorForDatabase(workspaceDev.postgres.database);
  console.log("pgvector extension enabled.");
}

function enablePgvectorForDatabase(databaseName: string): void {
  const workspaceDev = getWorkspaceDev();

  execDockerCompose(
    `exec -T postgres psql -U ${quoteShellArg(workspaceDev.postgres.user)} -d ${quoteShellArg(databaseName)} -c "CREATE EXTENSION IF NOT EXISTS vector;"`,
    { silent: true }
  );
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll(/'/g, "''")}'`;
}

function getDatabaseConfig(connectionString: string): {
  databaseName: string;
  password: string;
  user: string;
} {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\//, "");
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  if (!databaseName || !user || !password) {
    throw new Error(
      `Invalid local test database URL; expected database, user, and password: ${connectionString}`
    );
  }

  return {
    databaseName,
    password,
    user,
  };
}

async function provisionLocalTestDatabase(): Promise<void> {
  const testProfile = getTestProfile();
  const config = getDatabaseConfig(testProfile.database.url);

  // Comment: Route tests use the derived local test profile, so dev bootstrap
  // still provisions that database and role. Runtime startup and explicit test
  // harnesses own schema convergence after this bootstrap step.
  console.log(`Provisioning local test database (${config.databaseName})...`);

  const databaseName = quoteSqlLiteral(config.databaseName);
  const password = quoteSqlLiteral(config.password);
  const user = quoteSqlLiteral(config.user);
  const sql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${user}) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', ${user}, ${password});
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${user}, ${password});
  END IF;
END
$$;
SELECT format('CREATE DATABASE %I OWNER %I', ${databaseName}, ${user})
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = ${databaseName})\\gexec
`;

  execSync(
    `docker compose exec -T postgres psql -U ${quoteShellArg(getWorkspaceDev().postgres.user)} -d postgres`,
    {
      env: getDockerComposeEnv(),
      input: sql,
      stdio: ["pipe", "inherit", "inherit"],
    }
  );

  enablePgvectorForDatabase(config.databaseName);
}

function ensureWorkspaceDevSecretsFile(): void {
  const result = ensureWorkspaceDevSecretsFileSync({
    rootDir: process.cwd(),
  });

  if (!result.created) {
    return;
  }

  console.log(`Created ${result.path} with generated local secrets.`);
}

async function main(): Promise<void> {
  console.log("\n========================================");
  console.log("  OneQuery Development Environment Setup");
  console.log("========================================\n");

  ensureWorkspaceDevSecretsFile();
  getWorkspaceDev();

  if (!isDockerRunning()) {
    console.error(
      "Error: Docker is not running or not responding. Please start Docker first."
    );
    process.exit(1);
  }

  stopConflictingPostgres();

  // Start postgres
  console.log("Starting PostgreSQL container...");
  execDockerCompose("up -d postgres");

  const isReady = await waitForPostgres();
  if (!isReady) {
    console.error("Error: PostgreSQL failed to start.");
    process.exit(1);
  }

  enablePgvector();
  // Comment: Runtime startup owns schema convergence for the main app DB.
  // Local bootstrap is responsible only for shared infra plus the separate
  // local test database that route/server tests rely on.
  await provisionLocalTestDatabase();

  console.log("\n========================================");
  console.log("  Setup complete! Starting dev server...");
  console.log("========================================\n");
}

// Run the setup
main().catch((error) => {
  console.error("Setup failed:", error);
  process.exit(1);
});
