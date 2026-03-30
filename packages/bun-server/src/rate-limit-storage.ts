import { join } from "node:path";

import { isBetterAuthRateLimitEntry } from "@onequery/server/lib/rate-limit-storage";
import type {
  BetterAuthRateLimitStorage,
  RuntimeRateLimitStorage,
} from "@onequery/server/lib/rate-limit-storage";
import { createStorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";

import {
  RUNTIME_RATE_LIMIT_API_DIRNAME,
  RUNTIME_RATE_LIMIT_AUTH_DIRNAME,
} from "./constants";

function createPersistentBetterAuthRateLimitStorage(
  baseDir: string
): BetterAuthRateLimitStorage {
  const storage = createStorage({
    driver: fsLiteDriver({
      base: baseDir,
    }),
  });

  return {
    async get(key: string) {
      const value = await storage.getItem(key);

      if (value === null || value === undefined) {
        return undefined;
      }

      if (!isBetterAuthRateLimitEntry(value)) {
        throw new Error(
          "Persistent Better Auth rate limit storage returned invalid data"
        );
      }

      return value;
    },
    async set(key: string, value) {
      await storage.setItem(key, value);
    },
  };
}

export function createPersistentRuntimeRateLimitStorage(
  baseDir: string
): RuntimeRateLimitStorage {
  return {
    api: createStorage({
      driver: fsLiteDriver({
        base: join(baseDir, RUNTIME_RATE_LIMIT_API_DIRNAME),
      }),
    }),
    auth: createPersistentBetterAuthRateLimitStorage(
      join(baseDir, RUNTIME_RATE_LIMIT_AUTH_DIRNAME)
    ),
  };
}
