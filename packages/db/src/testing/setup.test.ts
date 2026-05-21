import { describe, expect } from "vitest";

import { organization } from "../schema";
import { eq } from "../shared";
import { test } from "./setup";

describe("PGlite Vitest fixture", { sequential: true, timeout: 60_000 }, () => {
  test("runs a test inside a migrated transaction", async ({ db }) => {
    await db.insert(organization).values({
      id: "fixture-rollback-org",
      name: "Fixture Rollback Org",
      slug: "fixture-rollback",
    });

    await expect(
      db
        .select()
        .from(organization)
        .where(eq(organization.id, "fixture-rollback-org"))
    ).resolves.toHaveLength(1);
  });

  test("rolls back writes from the previous test", async ({ db }) => {
    await expect(
      db
        .select()
        .from(organization)
        .where(eq(organization.id, "fixture-rollback-org"))
    ).resolves.toEqual([]);
  });
});
