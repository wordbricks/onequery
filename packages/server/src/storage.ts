import { createDatabaseRuntime } from "@onequery/db/server";
import type { Database, DatabaseSchema } from "@onequery/db/server";
import { createMiddleware } from "hono/factory";

import { createAuthFromConfig } from "./auth";
import type { Auth } from "./auth";
import type {
  AuthEmailDeliveryConfig,
  EmailDeliveryMode,
} from "./lib/email-delivery";
import { getEmailDeliveryMode } from "./lib/email-delivery";
import type { ApiRateLimitStorage } from "./lib/rate-limit-storage";
import type { ServerRuntimeConfig } from "./runtime";

export type ServerDatabase = Database;

export type ServerStorage = {
  auth: Auth;
  db: ServerDatabase;
  emailDelivery: AuthEmailDeliveryConfig;
  emailDeliveryMode: EmailDeliveryMode;
  engine: "postgres" | "pglite";
  schema: DatabaseSchema;
  apiRateLimitStorage: ApiRateLimitStorage;
};

export interface StorageVariables {
  storage: ServerStorage;
}

export interface CreateServerStorageOptions {
  enableAuthTestUtils?: boolean;
}

export function createServerStorage(
  runtime: ServerRuntimeConfig,
  apiRateLimitStorage: ApiRateLimitStorage,
  input: CreateServerStorageOptions = {}
): ServerStorage {
  const databaseRuntime = createDatabaseRuntime(
    runtime.storage.connectionString
  );

  return {
    auth: createAuthFromConfig(runtime, {
      db: databaseRuntime.db,
      enableTestUtils: input.enableAuthTestUtils,
      provider: "pg",
      schema: databaseRuntime.schema,
    }),
    db: databaseRuntime.db,
    emailDelivery: runtime.auth.emailDelivery,
    emailDeliveryMode: getEmailDeliveryMode(runtime.auth.emailDelivery),
    engine: databaseRuntime.engine,
    schema: databaseRuntime.schema,
    apiRateLimitStorage,
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
