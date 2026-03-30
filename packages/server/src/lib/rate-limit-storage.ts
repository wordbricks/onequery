import type { Storage } from "unstorage";

export type BetterAuthRateLimitEntry = {
  key: string;
  count: number;
  lastRequest: number;
};

export type BetterAuthRateLimitStorage = {
  get(key: string): Promise<BetterAuthRateLimitEntry | undefined>;
  set(key: string, value: BetterAuthRateLimitEntry): Promise<void>;
};

export type RuntimeRateLimitStorage = {
  api: Storage;
  auth: BetterAuthRateLimitStorage;
};

export function isBetterAuthRateLimitEntry(
  value: unknown
): value is BetterAuthRateLimitEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (!("key" in value) || typeof value.key !== "string") {
    return false;
  }

  if (!("count" in value) || typeof value.count !== "number") {
    return false;
  }

  return "lastRequest" in value && typeof value.lastRequest === "number";
}
