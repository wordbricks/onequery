import { createDatabaseRuntime } from "@onequery/db/server";
import type { Database, DatabaseSchema } from "@onequery/db/server";
import { createMiddleware } from "hono/factory";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { createAuth } from "./auth";
import type { Auth } from "./auth";
import { parseAuthEnv } from "./env";
import type { ServerEnv } from "./env";
import { createBetterAuthRateLimitStorage } from "./lib/better-auth-rate-limit-storage";
import type {
  AuthEmailDeliveryConfig,
  EmailDeliveryMode,
} from "./lib/email-delivery";
import { getEmailDeliveryMode } from "./lib/email-delivery";
import type { RuntimeRateLimitStorage } from "./lib/rate-limit-storage";

const SERVER_STORAGE_CACHE_SYMBOL = Symbol.for("onequery.server.storage-cache");

export type ServerDatabase = Database;

export type ServerStorage = {
  auth: Auth;
  authRateLimitStorage: ReturnType<typeof createBetterAuthRateLimitStorage>;
  db: ServerDatabase;
  emailDelivery: AuthEmailDeliveryConfig;
  emailDeliveryMode: EmailDeliveryMode;
  engine: "postgres" | "sqlite";
  schema: DatabaseSchema;
  apiRateLimitStorage: ReturnType<typeof createStorage>;
};

export interface StorageVariables {
  storage: ServerStorage;
}

type ServerStorageCache = Map<string, ServerStorage>;

function getServerStorageCache(): ServerStorageCache {
  const globalWithCache = globalThis as typeof globalThis & {
    [SERVER_STORAGE_CACHE_SYMBOL]?: ServerStorageCache;
  };

  if (!globalWithCache[SERVER_STORAGE_CACHE_SYMBOL]) {
    globalWithCache[SERVER_STORAGE_CACHE_SYMBOL] = new Map();
  }

  return globalWithCache[SERVER_STORAGE_CACHE_SYMBOL];
}

function createApiRateLimitStorage(
  runtimeRateLimitStorage?: RuntimeRateLimitStorage
) {
  if (runtimeRateLimitStorage) {
    return runtimeRateLimitStorage.api;
  }

  return createStorage({ driver: memoryDriver() });
}

function createServerStorage(env: ServerEnv): ServerStorage {
  const authConfig = parseAuthEnv(env);
  const databaseRuntime = createDatabaseRuntime(authConfig.databaseUrl);
  const authRateLimitStorage =
    authConfig.rateLimitStorage?.auth ?? createBetterAuthRateLimitStorage();

  return {
    auth: createAuth({
      ...authConfig,
      authRateLimitStorage,
      db: databaseRuntime.db,
      emailDelivery: authConfig.emailDelivery,
      provider: databaseRuntime.engine === "sqlite" ? "sqlite" : "pg",
      schema: databaseRuntime.schema,
    }),
    authRateLimitStorage,
    db: databaseRuntime.db,
    emailDelivery: authConfig.emailDelivery,
    emailDeliveryMode: getEmailDeliveryMode(authConfig.emailDelivery),
    engine: databaseRuntime.engine,
    schema: databaseRuntime.schema,
    apiRateLimitStorage: createApiRateLimitStorage(authConfig.rateLimitStorage),
  };
}

export function getServerStorage(env: ServerEnv): ServerStorage {
  const authConfig = parseAuthEnv(env);
  const cacheKey = [
    authConfig.databaseUrl,
    authConfig.secret,
    authConfig.baseURL ?? "",
    authConfig.rateLimitStorage ? "persistent" : "memory",
    authConfig.disableRateLimit ? "rate-limit-disabled" : "rate-limit-enabled",
    authConfig.emailDelivery.smtp?.host ?? "manual-link",
    authConfig.emailDelivery.smtp?.port ?? "no-port",
    authConfig.emailDelivery.smtp?.fromEmail ?? "no-from",
  ].join("|");

  const cache = getServerStorageCache();
  const cachedStorage = cache.get(cacheKey);
  if (cachedStorage) {
    return cachedStorage;
  }

  const storage = createServerStorage(env);
  cache.set(cacheKey, storage);
  return storage;
}

export function serverStorageMiddleware<
  Env extends ServerEnv = ServerEnv,
  Variables extends Record<string, unknown> = Record<string, never>,
>() {
  return createMiddleware<{
    Bindings: Env;
    Variables: StorageVariables & Variables;
  }>(async (c, next) => {
    (
      c as typeof c & {
        set: (key: "storage", value: ServerStorage) => void;
      }
    ).set("storage", getServerStorage(c.env));
    await next();
  });
}
