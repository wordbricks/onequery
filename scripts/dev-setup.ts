import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { prepareSelfHostDatabase } from "@onequery/db/server";
import { syncManagedLocalConfigFile } from "@onequery/dev-config/local-env";
import { loadLocalDevRuntimeSync } from "@onequery/dev-config/runtime";

import { assertDevTopologyArtifactsInSync } from "./lib/dev-topology-check.ts";

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;
const DOCKER_INFO_TIMEOUT_MS = 5000;

function getLocalDevRuntime() {
  return loadLocalDevRuntimeSync({
    rootDir: process.cwd(),
  });
}

function exec(
  command: string,
  options?: { silent?: boolean; timeoutMs?: number }
): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
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
    const result = exec("docker compose ps --format json", { silent: true });
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
  // checkout directory (for example `onequery-postgres-1` vs `onequery-oss-postgres-1`).
  const runtime = getLocalDevRuntime();
  const result = exec(
    `docker ps --filter "publish=${runtime.postgres.hostPort}" --format "{{.Names}}"`,
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
    const result = exec("docker compose ps --format json", { silent: true });
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
  const runtime = getLocalDevRuntime();
  console.log(
    `Enabling pgvector extension (${runtime.database.development.database})...`
  );
  enablePgvectorForDatabase(runtime.database.development.database);
  console.log("pgvector extension enabled.");
}

function enablePgvectorForDatabase(databaseName: string): void {
  exec(
    `docker compose exec -T postgres psql -U onequery -d ${databaseName} -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || docker-compose exec -T postgres psql -U onequery -d ${databaseName} -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null`,
    { silent: true }
  );
}

function getWorkspaceMigrationsDir(rootDir: string = process.cwd()): string {
  return resolve(rootDir, "packages", "db", "src", "migrations");
}

async function prepareDatabaseSchema(
  options: {
    connectionString?: string;
    label?: string;
  } = {}
): Promise<void> {
  const labelSuffix = options?.label ? ` (${options.label})` : "";
  console.log(`Applying database migrations${labelSuffix}...`);
  await prepareSelfHostDatabase({
    connectionString:
      options.connectionString ?? getLocalDevRuntime().database.development.url,
    migrationsFolder: getWorkspaceMigrationsDir(),
  });
  console.log("Database migrations applied.");
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
  const runtime = getLocalDevRuntime();
  const config = getDatabaseConfig(runtime.database.test.url);

  // Comment: Route tests default to LOCAL_TEST_DATABASE_URL, so dev bootstrap
  // must provision that database too; otherwise `bun run db:reset` leaves the
  // main dev DB healthy while server tests still fail against missing creds.
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

  execSync("docker compose exec -T postgres psql -U onequery -d postgres", {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });

  enablePgvectorForDatabase(config.databaseName);
  await prepareDatabaseSchema({
    connectionString: runtime.database.test.url,
    label: config.databaseName,
  });
}

function syncLocalConfigFile(): void {
  const configResult = syncManagedLocalConfigFile(process.cwd());

  if (configResult.created) {
    console.log(
      `Created ${configResult.path} from the managed local config contract.`
    );
  } else if (configResult.addedKeys.length > 0) {
    console.log(
      `Updated ${configResult.path} with ${configResult.addedKeys.length} new managed key(s): ${configResult.addedKeys.join(", ")}`
    );
  }

  if (configResult.errors.length === 0) {
    return;
  }

  const lines = ["Error: managed local configuration validation failed."];

  if (configResult.errors.length > 0) {
    lines.push(`Config file: ${configResult.path}`);
    for (const error of configResult.errors) {
      lines.push(`- ${error}`);
    }
  }

  lines.push("Run `bun run env:sync` to refresh the tracked TOML artifact.");
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("\n========================================");
  console.log("  OneQuery Development Environment Setup");
  console.log("========================================\n");

  assertDevTopologyArtifactsInSync();
  syncLocalConfigFile();

  if (!isDockerRunning()) {
    console.error(
      "Error: Docker is not running or not responding. Please start Docker first."
    );
    process.exit(1);
  }

  stopConflictingPostgres();

  // Start postgres
  console.log("Starting PostgreSQL container...");
  exec("docker compose up -d postgres");

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
