import { describe, expect, it } from "vitest";

import { validateAndNormalizeReadOnlyQuery } from "./validate-sql";

async function expectValidationError(sql: string, message: string) {
  const result = await validateAndNormalizeReadOnlyQuery(sql, "postgres");

  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error(`expected validation error for SQL: ${sql}`);
  }
  expect(result.error.message).toBe(message);
}

describe("validateAndNormalizeReadOnlyQuery", () => {
  it("adds a default limit to read-only selects", async () => {
    const result = await validateAndNormalizeReadOnlyQuery(
      "SELECT id FROM users",
      "postgres"
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      changed: true,
      sql: "SELECT id FROM users LIMIT 1000",
    });
  });

  it("clamps existing limits above the maximum", async () => {
    const result = await validateAndNormalizeReadOnlyQuery(
      "SELECT id FROM users LIMIT 2000",
      "postgres"
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      changed: true,
      sql: "SELECT id FROM users LIMIT 1000",
    });
  });

  it("preserves selects whose limit is already within bounds", async () => {
    const sql = "SELECT id FROM users LIMIT 25";
    const result = await validateAndNormalizeReadOnlyQuery(sql, "postgres");

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      changed: false,
      sql,
    });
  });

  it("adds a limit to set operations", async () => {
    const result = await validateAndNormalizeReadOnlyQuery(
      "SELECT id FROM users UNION SELECT id FROM archived_users",
      "postgres"
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      changed: true,
      sql: "SELECT id FROM users UNION SELECT id FROM archived_users LIMIT 1000",
    });
  });

  it("rejects unsafe or unsupported statements", async () => {
    await expectValidationError(
      "DELETE FROM users",
      "Only SELECT queries are allowed. Got: delete"
    );
    await expectValidationError(
      "SELECT 1; SELECT 2",
      "Multiple statements are not allowed"
    );
    await expectValidationError(
      "WITH cte AS (DELETE FROM users) SELECT * FROM cte",
      "CTEs must only contain SELECT statements"
    );
    await expectValidationError(
      "SELECT * INTO new_users FROM users",
      "SELECT INTO is not allowed"
    );
    await expectValidationError(
      "SELECT id FROM users LIMIT ?",
      "LIMIT value must be numeric"
    );
  });
});
