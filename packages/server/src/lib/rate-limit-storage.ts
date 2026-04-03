import { createStorage } from "unstorage";
import type { Storage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

export type ApiRateLimitStorage = Storage;

export function createMemoryApiRateLimitStorage(): ApiRateLimitStorage {
  return createStorage({ driver: memoryDriver() });
}
