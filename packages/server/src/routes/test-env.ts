import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import type {
  ServerRuntimeConfig,
  ServerRuntimeStorageConfig,
} from "../runtime";
import { deriveKeyFromBase64Result } from "../services/crypto/credential-encryption";

export const TEST_PUBLIC_ORIGIN = "http://localhost:4545";
export const TEST_SERVER_MASTER_ENCRYPTION_KEY =
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
export const DEFAULT_TEST_DATABASE_URL = "pglite:/tmp/onequery/test/pglite";

export type TestRuntimeConfigOverrides = Omit<
  Partial<ServerRuntimeConfig>,
  "auth" | "connectors" | "crypto" | "listen" | "rateLimit"
> & {
  auth?: Partial<ServerRuntimeConfig["auth"]>;
  connectors?: Partial<ServerRuntimeConfig["connectors"]>;
  crypto?: {
    masterEncryptionKey?: string | Uint8Array;
  };
  databaseUrl?: string;
  listen?: Partial<ServerRuntimeConfig["listen"]>;
  rateLimit?: Partial<ServerRuntimeConfig["rateLimit"]>;
};

export class TestRuntimeConfigError extends TaggedError(
  "TestRuntimeConfigError"
)<{
  cause?: unknown;
  field: "crypto.masterEncryptionKey";
  message: string;
}>() {}

export type TestRuntimeConfigResult = ResultType<
  ServerRuntimeConfig,
  TestRuntimeConfigError
>;

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

const defaultRuntimeBase = {
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
  listen: {
    host: "127.0.0.1",
    port: 4555,
  },
  publicOrigin: TEST_PUBLIC_ORIGIN,
  rateLimit: {
    api: {
      storage: "memory",
    },
    enabled: false,
  },
  runtimePaths: undefined,
} satisfies Omit<ServerRuntimeConfig, "crypto" | "storage">;

export function createTestRuntimeConfig(
  overrides: TestRuntimeConfigOverrides = {}
): TestRuntimeConfigResult {
  const { databaseUrl, ...runtimeOverrides } = overrides;
  const runtimeStorage =
    databaseUrl !== undefined
      ? toRuntimeStorageConfig(databaseUrl)
      : (runtimeOverrides.storage ??
        toRuntimeStorageConfig(DEFAULT_TEST_DATABASE_URL));

  return Result.gen(function* createTestRuntimeConfigFlow() {
    const masterEncryptionKey = yield* resolveTestMasterEncryptionKeyResult(
      runtimeOverrides.crypto?.masterEncryptionKey
    );

    return Result.ok({
      ...defaultRuntimeBase,
      ...runtimeOverrides,
      auth: {
        ...defaultRuntimeBase.auth,
        ...runtimeOverrides.auth,
        emailDelivery:
          runtimeOverrides.auth?.emailDelivery ??
          defaultRuntimeBase.auth.emailDelivery,
      },
      connectors: {
        ...defaultRuntimeBase.connectors,
        ...runtimeOverrides.connectors,
      },
      crypto: {
        masterEncryptionKey,
      },
      listen: {
        ...defaultRuntimeBase.listen,
        ...runtimeOverrides.listen,
      },
      rateLimit: {
        ...defaultRuntimeBase.rateLimit,
        ...runtimeOverrides.rateLimit,
      },
      storage: runtimeStorage,
    });
  });
}

function resolveTestMasterEncryptionKeyResult(
  value: NonNullable<
    TestRuntimeConfigOverrides["crypto"]
  >["masterEncryptionKey"]
): ResultType<Uint8Array, TestRuntimeConfigError> {
  if (value instanceof Uint8Array) {
    return Result.ok(value);
  }

  const parsed = deriveKeyFromBase64Result(
    value ?? TEST_SERVER_MASTER_ENCRYPTION_KEY
  );
  if (parsed.isErr()) {
    return Result.err(
      new TestRuntimeConfigError({
        cause: parsed.error,
        field: "crypto.masterEncryptionKey",
        message: `Invalid test runtime crypto.masterEncryptionKey: ${parsed.error.message}`,
      })
    );
  }

  return Result.ok(parsed.value);
}

export function createTestRuntimeConfigFromDatabaseUrl(
  databaseUrl: string,
  overrides: TestRuntimeConfigOverrides = {}
): TestRuntimeConfigResult {
  return createTestRuntimeConfig({
    ...overrides,
    databaseUrl,
  });
}
