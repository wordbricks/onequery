import { createDatabaseRuntime } from "@onequery/db/server";
import type { Database, DatabaseSchema } from "@onequery/db/server";
import { createMiddleware } from "hono/factory";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { createAuthFromConfig } from "./auth";
import type { Auth } from "./auth";
import { createBetterAuthRateLimitStorage } from "./lib/better-auth-rate-limit-storage";
import type {
  AuthEmailDeliveryConfig,
  EmailDeliveryMode,
} from "./lib/email-delivery";
import { getEmailDeliveryMode } from "./lib/email-delivery";
import type { RuntimeRateLimitStorage } from "./lib/rate-limit-storage";
import type { ServerRuntimeConfig } from "./runtime";

export type ServerDatabase = Database;

export type ServerStorage = {
  auth: Auth;
  authRateLimitStorage: ReturnType<typeof createBetterAuthRateLimitStorage>;
  db: ServerDatabase;
  emailDelivery: AuthEmailDeliveryConfig;
  emailDeliveryMode: EmailDeliveryMode;
  engine: "postgres" | "pglite";
  schema: DatabaseSchema;
  apiRateLimitStorage: ReturnType<typeof createStorage>;
};

export interface StorageVariables {
  storage: ServerStorage;
}

function createApiRateLimitStorage(
  runtimeRateLimitStorage?: RuntimeRateLimitStorage
) {
  if (runtimeRateLimitStorage) {
    return runtimeRateLimitStorage.api;
  }

  return createStorage({ driver: memoryDriver() });
}

export interface CreateServerStorageOptions {
  enableAuthTestUtils?: boolean;
}

export function createServerStorage(
  runtime: ServerRuntimeConfig,
  input: CreateServerStorageOptions = {}
): ServerStorage {
  const databaseRuntime = createDatabaseRuntime(
    runtime.storage.connectionString
  );
  const authRateLimitStorage =
    runtime.rateLimit.runtimeStorage?.auth ??
    createBetterAuthRateLimitStorage();

  return {
    auth: createAuthFromConfig(runtime, {
      authRateLimitStorage,
      db: databaseRuntime.db,
      enableTestUtils: input.enableAuthTestUtils,
      provider: "pg",
      schema: databaseRuntime.schema,
    }),
    authRateLimitStorage,
    db: databaseRuntime.db,
    emailDelivery: runtime.auth.emailDelivery,
    emailDeliveryMode: getEmailDeliveryMode(runtime.auth.emailDelivery),
    engine: databaseRuntime.engine,
    schema: databaseRuntime.schema,
    apiRateLimitStorage: createApiRateLimitStorage(
      runtime.rateLimit.runtimeStorage
    ),
  };
}

export function serverStorageMiddleware<
  Variables extends Record<string, unknown> = Record<string, never>,
>(storage: ServerStorage) {
  return createMiddleware<{
    Variables: StorageVariables & Variables;
  }>(async (c, next) => {
    (
      c as typeof c & {
        set: (key: "storage", value: ServerStorage) => void;
      }
    ).set("storage", storage);
    await next();
  });
}
