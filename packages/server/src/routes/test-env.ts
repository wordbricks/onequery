import type { ServerRuntimeConfig, ServerRuntimeStorageConfig } from "../runtime";

export const TEST_PUBLIC_ORIGIN = "http://localhost:4545";
export const TEST_SERVER_MASTER_ENCRYPTION_KEY =
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
export const DEFAULT_TEST_DATABASE_URL =
  "postgres://test:test@localhost:5454/test";

export type TestRuntimeConfigOverrides = Omit<
  Partial<ServerRuntimeConfig>,
  "auth" | "connectors" | "crypto" | "listen" | "rateLimit"
> & {
  auth?: Partial<ServerRuntimeConfig["auth"]>;
  connectors?: Partial<ServerRuntimeConfig["connectors"]>;
  crypto?: Partial<ServerRuntimeConfig["crypto"]>;
  databaseUrl?: string;
  listen?: Partial<ServerRuntimeConfig["listen"]>;
  rateLimit?: Partial<ServerRuntimeConfig["rateLimit"]>;
};

function toRuntimeStorageConfig(
  connectionString: string
): ServerRuntimeStorageConfig {
  if (connectionString.startsWith("pglite:")) {
    return {
      connectionString,
      dir: connectionString.slice("pglite:".length),
      kind: "pglite",
    };
  }

  return {
    connectionString,
    kind: "postgres",
    url: connectionString,
  };
}

const defaultRuntime: ServerRuntimeConfig = {
  auth: {
    baseURL: TEST_PUBLIC_ORIGIN,
    emailDelivery: {
      baseURL: TEST_PUBLIC_ORIGIN,
    },
    secret: "test-better-auth-secret",
  },
  connectors: {
    enrollmentToken: "test-connector-token",
  },
  crypto: {
    masterEncryptionKey: TEST_SERVER_MASTER_ENCRYPTION_KEY,
  },
  listen: {
    host: "127.0.0.1",
    port: 4555,
  },
  mode: "workspace-dev",
  publicOrigin: TEST_PUBLIC_ORIGIN,
  rateLimit: {
    enabled: false,
    storage: "memory",
  },
  runtimePaths: undefined,
  storage: toRuntimeStorageConfig(DEFAULT_TEST_DATABASE_URL),
};

export function createTestRuntimeConfig(
  overrides: TestRuntimeConfigOverrides = {}
): ServerRuntimeConfig {
  const runtimeStorage =
    overrides.databaseUrl !== undefined
      ? toRuntimeStorageConfig(overrides.databaseUrl)
      : overrides.storage ?? defaultRuntime.storage;

  return {
    ...defaultRuntime,
    ...overrides,
    auth: {
      ...defaultRuntime.auth,
      ...overrides.auth,
      emailDelivery:
        overrides.auth?.emailDelivery ?? defaultRuntime.auth.emailDelivery,
    },
    connectors: {
      ...defaultRuntime.connectors,
      ...overrides.connectors,
    },
    crypto: {
      ...defaultRuntime.crypto,
      ...overrides.crypto,
    },
    listen: {
      ...defaultRuntime.listen,
      ...overrides.listen,
    },
    rateLimit: {
      ...defaultRuntime.rateLimit,
      ...overrides.rateLimit,
    },
    storage: runtimeStorage,
  };
}

export function createTestRuntimeConfigFromDatabaseUrl(
  databaseUrl: string,
  overrides: TestRuntimeConfigOverrides = {}
): ServerRuntimeConfig {
  return createTestRuntimeConfig({
    ...overrides,
    databaseUrl,
  });
}
