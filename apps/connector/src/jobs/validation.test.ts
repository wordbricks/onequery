import { describe, expect, it } from "vitest";

import { validateAthenaSql } from "./validation";

function expectValidSql(sql: string, expectedSql = sql) {
  const result = validateAthenaSql(sql);

  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }
  expect(result.value).toEqual({ sql: expectedSql });
}

function expectInvalidSql(sql: string, message: string) {
  const result = validateAthenaSql(sql);

  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error(`expected validation error for SQL: ${sql}`);
  }
  expect(result.error.message).toBe(message);
}

describe("validateAthenaSql", () => {
  it("allows read-only SHOW metadata statements", () => {
    expectValidSql("SHOW TABLES");
    expectValidSql("SHOW CREATE TABLE orders");
  });

  it("keeps rejecting mutable and multi-statement SQL", () => {
    expectInvalidSql(
      "CREATE TABLE copied AS SELECT 1",
      "Only SELECT, WITH, or SHOW queries are allowed"
    );
    expectInvalidSql(
      "SHOW TABLES; DROP TABLE orders",
      "Multiple statements are not allowed"
    );
  });
});
