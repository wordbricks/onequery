import type {
  BetterAuthRateLimitEntry,
  BetterAuthRateLimitStorage,
} from "./rate-limit-storage";

const memoryRateLimitStorage = new Map<string, BetterAuthRateLimitEntry>();

function createMemoryRateLimitStorage(): BetterAuthRateLimitStorage {
  return {
    async get(key: string) {
      return memoryRateLimitStorage.get(key);
    },
    async set(key: string, value: BetterAuthRateLimitEntry) {
      memoryRateLimitStorage.set(key, value);
    },
  };
}

export function createBetterAuthRateLimitStorage(): BetterAuthRateLimitStorage {
  return createMemoryRateLimitStorage();
}
