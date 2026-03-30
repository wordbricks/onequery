import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createPersistentRuntimeRateLimitStorage } from "./rate-limit-storage";

describe("persistent runtime rate-limit storage", () => {
  it("persists Better Auth and API rate-limit state across storage recreation", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "onequery-rate-limit-storage-"));

    const firstStorage = createPersistentRuntimeRateLimitStorage(baseDir);
    await firstStorage.auth.set("signup:user@example.com", {
      count: 2,
      key: "signup:user@example.com",
      lastRequest: 1_742_861_200_000,
    });
    await firstStorage.api.setItem("user:123", {
      count: 4,
      firstHitAt: 1_742_861_200_000,
    });

    const secondStorage = createPersistentRuntimeRateLimitStorage(baseDir);

    await expect(
      secondStorage.auth.get("signup:user@example.com")
    ).resolves.toEqual({
      count: 2,
      key: "signup:user@example.com",
      lastRequest: 1_742_861_200_000,
    });
    await expect(secondStorage.api.getItem("user:123")).resolves.toEqual({
      count: 4,
      firstHitAt: 1_742_861_200_000,
    });
  });
});
