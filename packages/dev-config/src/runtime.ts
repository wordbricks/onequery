import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  literalConfigAdapter,
  loadConfigFromSourcesSync,
} from "@onequery/config-loader";
import {
  getLocalConfigPath,
  getManagedLocalConfigDefaults,
  managedLocalConfigSourceSchema,
} from "@onequery/dev-config/local-env";
import {
  LOCAL_DATABASE_URL,
  LOCAL_DEV_LOOPBACK_HOST,
  LOCAL_POSTGRES_CONTAINER_PORT,
  LOCAL_POSTGRES_HOST_PORT,
  LOCAL_TEST_DATABASE_URL,
  LOCAL_WEB_API_DEV_ORIGIN,
  LOCAL_WEB_API_DEV_PORT,
  LOCAL_WEB_PORT,
} from "@onequery/dev-config/topology";
import { z } from "zod";

const defaultRootDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const MANAGED_WEB_URL_KEY = "WEB_URL";
const MANAGED_BETTER_AUTH_URL_KEY = "BETTER_AUTH_URL";
const MANAGED_DATABASE_URL_KEY = "DATABASE_URL";
const ENV_SYNC_HINT =
  'Set it in "onequery.local.env.toml" and run `bun run env:sync`.';
const LOCAL_DEV_RUNTIME_DEFAULTS = getManagedLocalConfigDefaults([
  "DATABASE_URL",
  "WEB_URL",
]);

function normalizeConfiguredUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function parseConfiguredUrl(
  value: string,
  key: string,
  options: {
    readonly expectedPort?: number;
  } = {}
): {
  readonly origin: string;
  readonly port: number;
} {
  const normalized = normalizeConfiguredUrl(value);

  if (normalized.length === 0) {
    throw new Error(`${key} is required for local dev. ${ENV_SYNC_HINT}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${key} must be a valid URL. ${ENV_SYNC_HINT}`);
  }

  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      `${key} must be an origin without path, query, or hash. ${ENV_SYNC_HINT}`
    );
  }

  if (parsed.port.length === 0) {
    throw new Error(
      `${key} must include an explicit port for local dev. ${ENV_SYNC_HINT}`
    );
  }

  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `${key} must include a valid port for local dev. ${ENV_SYNC_HINT}`
    );
  }

  if (options.expectedPort !== undefined && port !== options.expectedPort) {
    throw new Error(
      `${key} must use local dev web port ${options.expectedPort}. ${ENV_SYNC_HINT}`
    );
  }

  return {
    origin: parsed.origin,
    port,
  };
}

function parsePostgresConnectionString(
  value: string,
  key: string
): LocalDevRuntimeDatabaseConnection {
  const normalized = value.trim();

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${key} must be a valid Postgres connection string.`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${key} must use the postgres:// protocol.`);
  }

  const database = parsed.pathname.replace(/^\/+/u, "");
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const port = parsed.port.length > 0 ? Number.parseInt(parsed.port, 10) : 5432;

  if (!database || !user || !password) {
    throw new Error(
      `${key} must include a database name, username, and password.`
    );
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${key} must include a valid port.`);
  }

  return {
    database,
    host: parsed.hostname,
    password,
    port,
    url: normalized,
    user,
  };
}

const localDevRuntimeManagedSourceSchema = managedLocalConfigSourceSchema.pick({
  BETTER_AUTH_URL: true,
  DATABASE_URL: true,
  WEB_URL: true,
});

const localDevRuntimeSchema = localDevRuntimeManagedSourceSchema.transform(
  (value) => {
    const web = parseConfiguredUrl(value.WEB_URL ?? "", MANAGED_WEB_URL_KEY, {
      expectedPort: LOCAL_WEB_PORT,
    });
    const auth = parseConfiguredUrl(
      value.BETTER_AUTH_URL ?? value.WEB_URL ?? "",
      MANAGED_BETTER_AUTH_URL_KEY,
      {
        expectedPort: LOCAL_WEB_PORT,
      }
    );

    if (auth.origin !== web.origin) {
      throw new Error(
        `${MANAGED_BETTER_AUTH_URL_KEY} must match ${MANAGED_WEB_URL_KEY} in local dev. ${ENV_SYNC_HINT}`
      );
    }

    return {
      api: {
        host: LOCAL_DEV_LOOPBACK_HOST,
        origin: LOCAL_WEB_API_DEV_ORIGIN,
        port: LOCAL_WEB_API_DEV_PORT,
      },
      auth: {
        origin: auth.origin,
      },
      database: {
        development: parsePostgresConnectionString(
          value.DATABASE_URL ?? LOCAL_DATABASE_URL,
          MANAGED_DATABASE_URL_KEY
        ),
        test: parsePostgresConnectionString(
          LOCAL_TEST_DATABASE_URL,
          "LOCAL_TEST_DATABASE_URL"
        ),
      },
      postgres: {
        containerPort: LOCAL_POSTGRES_CONTAINER_PORT,
        hostPort: LOCAL_POSTGRES_HOST_PORT,
      },
      web: {
        origin: web.origin,
        port: web.port,
      },
    } as const;
  }
);

export type LocalDevRuntimeDatabaseConnection = {
  readonly database: string;
  readonly host: string;
  readonly password: string;
  readonly port: number;
  readonly url: string;
  readonly user: string;
};

export type LocalDevRuntimeConfig = z.output<typeof localDevRuntimeSchema>;

export interface LoadLocalDevRuntimeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly rootDir?: string;
}

export function loadLocalDevRuntimeSync(
  input: LoadLocalDevRuntimeOptions = {}
): Readonly<LocalDevRuntimeConfig> {
  const rootDir = input.rootDir ?? defaultRootDir;

  return localDevRuntimeSchema.parse(
    loadConfigFromSourcesSync({
      adapters: [
        literalConfigAdapter({
          data: LOCAL_DEV_RUNTIME_DEFAULTS,
          name: "@onequery/dev-config local runtime",
        }),
      ],
      env: input.env,
      schema: localDevRuntimeManagedSourceSchema,
      tomlPath: getLocalConfigPath(rootDir),
    })
  );
}
