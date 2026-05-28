import type { DatabaseCredentialProviderType } from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import { validateAndNormalizeReadOnlyQuery } from "./validate-sql";

async function expectValidQuery(
  sql: string,
  expected: { sql: string },
  dbType: DatabaseCredentialProviderType = "postgres"
) {
  const result = await validateAndNormalizeReadOnlyQuery(sql, dbType);

  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }
  expect(result.value).toEqual(expected);
}

async function expectValidationError(
  sql: string,
  message: string,
  dbType: DatabaseCredentialProviderType = "postgres"
) {
  const result = await validateAndNormalizeReadOnlyQuery(sql, dbType);

  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error(`expected validation error for SQL: ${sql}`);
  }
  expect(result.error.message).toBe(message);
}

describe("validateAndNormalizeReadOnlyQuery", () => {
  it("preserves read-only selects without adding or changing limits", async () => {
    let sql = "SELECT id FROM users";
    await expectValidQuery(sql, {
      sql,
    });

    sql = "SELECT id FROM users LIMIT 2000";
    await expectValidQuery(sql, {
      sql,
    });

    sql = "SELECT id FROM users LIMIT ?";
    await expectValidQuery(sql, {
      sql,
    });

    sql = "SELECT id FROM users LIMIT 10 PERCENT";
    await expectValidQuery(sql, {
      sql,
    });

    sql = "SELECT id FROM users FETCH FIRST 10 ROWS WITH TIES";
    await expectValidQuery(sql, {
      sql,
    });
  });

  it("supports safe parenthesized selects", async () => {
    let sql = "(SELECT id FROM users)";
    await expectValidQuery(sql, {
      sql,
    });

    sql = "((SELECT id FROM users LIMIT 25))";
    await expectValidQuery(sql, {
      sql,
    });
  });

  it("validates Cloudflare D1 queries with the SQLite dialect", async () => {
    await expectValidQuery(
      "SELECT json_extract(payload, '$.kind') AS kind FROM events LIMIT 10",
      {
        sql: "SELECT json_extract(payload, '$.kind') AS kind FROM events LIMIT 10",
      },
      "cloudflare_d1"
    );

    await expectValidationError(
      "DELETE FROM events",
      "Only SELECT queries are allowed. Got: delete",
      "cloudflare_d1"
    );
  });

  it("validates Snowflake queries with the Snowflake dialect", async () => {
    await expectValidQuery(
      "SELECT id FROM events QUALIFY ROW_NUMBER() OVER (ORDER BY created_at DESC) <= 10",
      {
        sql: "SELECT id FROM events QUALIFY ROW_NUMBER() OVER (ORDER BY created_at DESC) <= 10",
      },
      "snowflake"
    );

    await expectValidationError(
      "PUT file:///tmp/users.csv @analytics_stage",
      "Only SELECT queries are allowed. Got: put",
      "snowflake"
    );
  });

  it("validates MotherDuck queries with the PostgreSQL-compatible dialect", async () => {
    await expectValidQuery(
      "SELECT * FROM sample_data.hn.hacker_news LIMIT 10",
      {
        sql: "SELECT * FROM sample_data.hn.hacker_news LIMIT 10",
      },
      "motherduck"
    );

    await expectValidationError(
      "CREATE TABLE copied AS SELECT 1",
      "Only SELECT queries are allowed. Got: create_table",
      "motherduck"
    );
  });

  it("preserves set operations without adding or changing limits", async () => {
    let bounded = "SELECT id FROM users UNION SELECT id FROM archived_users";
    await expectValidQuery(bounded, {
      sql: bounded,
    });

    bounded =
      "SELECT id FROM users UNION ALL SELECT id FROM archived_users LIMIT 2000";
    await expectValidQuery(bounded, {
      sql: bounded,
    });

    bounded =
      "SELECT id FROM users UNION SELECT id FROM archived_users UNION SELECT id FROM deleted_users LIMIT 2000";
    await expectValidQuery(bounded, {
      sql: bounded,
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
  });

  it("rejects mutable or side-effecting constructs anywhere in the tree", async () => {
    await expectValidationError(
      "SELECT * FROM (DELETE FROM users RETURNING *) x",
      "Only SELECT queries are allowed. Got: delete"
    );
    await expectValidationError(
      "SELECT * FROM (INSERT INTO users(id) VALUES (1) RETURNING *) x",
      "Only SELECT queries are allowed. Got: insert"
    );
    await expectValidationError(
      "SELECT * FROM (CREATE TABLE new_users AS SELECT * FROM users) x",
      "Only SELECT queries are allowed. Got: create_table"
    );
    await expectValidationError(
      "SELECT * FROM (SELECT * INTO new_users FROM users) x",
      "SELECT INTO is not allowed"
    );
    await expectValidationError(
      "SELECT * FROM users INTO OUTFILE '/tmp/users.csv'",
      "SELECT INTO OUTFILE/DUMPFILE is not allowed",
      "mysql"
    );
  });

  it("does not treat MySQL OUTFILE text in literals or comments as an OUTFILE clause", async () => {
    let sql = "SELECT 'INTO OUTFILE'";
    await expectValidQuery(
      sql,
      {
        sql,
      },
      "mysql"
    );

    sql = "SELECT 1 -- INTO OUTFILE\n";
    await expectValidQuery(
      sql,
      {
        sql: sql.trim(),
      },
      "mysql"
    );

    sql = "SELECT 1 /* INTO OUTFILE */";
    await expectValidQuery(
      sql,
      {
        sql,
      },
      "mysql"
    );
  });

  it("rejects side-effecting functions", async () => {
    await expectValidationError(
      "SELECT pg_advisory_lock(1)",
      "Side-effecting SQL functions are not allowed: pg_advisory_lock"
    );
    await expectValidationError(
      "SELECT pg_catalog.pg_advisory_lock(1)",
      "Side-effecting SQL functions are not allowed: pg_advisory_lock"
    );
    await expectValidationError(
      "SELECT dblink_exec('conn', 'DROP TABLE users')",
      "Side-effecting SQL functions are not allowed: dblink_exec"
    );
    await expectValidationError(
      "SELECT nextval('users_id_seq')",
      "Side-effecting SQL functions are not allowed: nextval"
    );
    await expectValidationError(
      "SELECT GET_LOCK('users', 1)",
      "Side-effecting SQL functions are not allowed: get_lock",
      "mysql"
    );
    await expectValidationError(
      "SELECT @x := 1",
      "Only SELECT queries are allowed. Got: property_e_q",
      "mysql"
    );
    await expectValidationError(
      "SELECT SYSTEM$WAIT(1)",
      "Side-effecting SQL functions are not allowed: system$wait",
      "snowflake"
    );
  });

  it("rejects locking reads", async () => {
    await expectValidationError(
      "SELECT id FROM users FOR UPDATE",
      "SELECT locking clauses are not allowed"
    );
    await expectValidationError(
      "SELECT id FROM users LOCK IN SHARE MODE",
      "SELECT locking clauses are not allowed",
      "mysql"
    );
  });

  it("uses strict syntax validation before parsing", async () => {
    await expectValidationError(
      "SELECT name, FROM employees",
      "Failed to parse SQL: Trailing comma before FROM is not allowed in strict syntax mode"
    );
  });
});
