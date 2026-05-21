import { DATABASE_CREDENTIAL_PROVIDER_TYPES } from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import { queryDriverRegistry } from "./registry";

describe("query driver registry", () => {
  it("has an exhaustive driver for every database credential provider", () => {
    expect(Object.keys(queryDriverRegistry).sort()).toEqual(
      [...DATABASE_CREDENTIAL_PROVIDER_TYPES].sort()
    );
  });

  it("keeps each driver self-identifying by its registry provider", () => {
    for (const provider of DATABASE_CREDENTIAL_PROVIDER_TYPES) {
      expect(queryDriverRegistry[provider].provider).toBe(provider);
    }
  });
});
