import { createDb, getDatabaseEngine } from "@onequery/db/server";
import type { Database, DatabaseEngine } from "@onequery/db/server";
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

export type ServerStorage = {
  auth: Auth;
  db: Database;
  emailDelivery: AuthEmailDeliveryConfig;
  emailDeliveryMode: EmailDeliveryMode;
  engine: DatabaseEngine;
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
  const db = createDb(runtime.storage.connectionString);

  return {
    auth: createAuthFromConfig(runtime, {
      db,
      enableTestUtils: input.enableAuthTestUtils,
      provider: "pg",
    }),
    db,
    emailDelivery: runtime.auth.emailDelivery,
    emailDeliveryMode: getEmailDeliveryMode(runtime.auth.emailDelivery),
    engine: getDatabaseEngine(runtime.storage.connectionString),
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
