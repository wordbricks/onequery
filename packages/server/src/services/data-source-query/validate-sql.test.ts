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

  it("allows read-only metadata statements", async () => {
    await expectValidQuery("SHOW ALL", { sql: "SHOW ALL" }, "postgres");
    await expectValidQuery("SHOW TABLES", { sql: "SHOW TABLES" }, "mysql");
    await expectValidQuery(
      "SHOW CREATE TABLE orders",
      { sql: "SHOW CREATE TABLE orders" },
      "aws_athena_connector"
    );
    await expectValidQuery(
      "SHOW TABLES WHERE Tables_in_test LIKE 'user%'",
      { sql: "SHOW TABLES WHERE Tables_in_test LIKE 'user%'" },
      "mysql"
    );
    await expectValidQuery("SHOW TABLES", { sql: "SHOW TABLES" }, "laminar");
    await expectValidQuery(
      "DESCRIBE users",
      { sql: "DESCRIBE users" },
      "mysql"
    );
    await expectValidQuery("DESC users", { sql: "DESC users" }, "mysql");
    await expectValidQuery(
      "EXPLAIN SELECT * FROM users",
      { sql: "EXPLAIN SELECT * FROM users" },
      "postgres"
    );
    await expectValidQuery(
      "EXPLAIN ANALYZE SELECT * FROM users",
      { sql: "EXPLAIN ANALYZE SELECT * FROM users" },
      "postgres"
    );
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
      "Only SELECT, SHOW, DESCRIBE, EXPLAIN, or PRAGMA queries are allowed. Got: delete",
      "cloudflare_d1"
    );
  });

  it("allows read-only Cloudflare D1 PRAGMA statements", async () => {
    const pragmaQueries = [
      "PRAGMA table_list",
      'PRAGMA table_info("events")',
      "PRAGMA table_xinfo(events)",
      "PRAGMA index_list(events)",
      "PRAGMA index_info(idx_events_created_at)",
      "PRAGMA index_xinfo(idx_events_created_at)",
      "PRAGMA foreign_key_list(events)",
      "PRAGMA foreign_key_check",
      "PRAGMA quick_check",
    ];

    for (const sql of pragmaQueries) {
      await expectValidQuery(
        sql,
        {
          sql,
        },
        "cloudflare_d1"
      );
    }
  });

  it("rejects D1 PRAGMA statements that are not read-only metadata", async () => {
    for (const sql of [
      "PRAGMA foreign_keys=off",
      "PRAGMA foreign_keys",
      "PRAGMA case_sensitive_like",
      "PRAGMA optimize",
      "PRAGMA table_info(randomblob(1))",
    ]) {
      await expectValidationError(
        sql,
        "Only read-only PRAGMA statements are allowed",
        "cloudflare_d1"
      );
    }
  });

  it("validates Cloudflare R2 SQL queries with the Athena dialect", async () => {
    await expectValidQuery(
      "SELECT * FROM default.transactions LIMIT 10",
      {
        sql: "SELECT * FROM default.transactions LIMIT 10",
      },
      "cloudflare_r2_sql"
    );

    await expectValidationError(
      "CREATE TABLE copied AS SELECT 1",
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: create_table",
      "cloudflare_r2_sql"
    );
  });

  it("allows Cloudflare R2 SQL metadata commands", async () => {
    const metadataQueries = [
      "SHOW DATABASES",
      "SHOW SCHEMAS",
      "SHOW TABLES",
      "SHOW TABLES IN default",
      "SHOW COLUMNS FROM default.transactions",
      "DESCRIBE default.transactions",
      "DESCRIBE TABLE default.transactions",
      "DESC default.transactions",
      "EXPLAIN SELECT * FROM default.transactions",
      "EXPLAIN ANALYZE SELECT * FROM default.transactions",
    ];

    for (const sql of metadataQueries) {
      await expectValidQuery(
        sql,
        {
          sql,
        },
        "cloudflare_r2_sql"
      );
    }
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
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: put",
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
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: create_table",
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
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: delete"
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
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: delete"
    );
    await expectValidationError(
      "SELECT * FROM (INSERT INTO users(id) VALUES (1) RETURNING *) x",
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: insert"
    );
    await expectValidationError(
      "SELECT * FROM (CREATE TABLE new_users AS SELECT * FROM users) x",
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: create_table"
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
      "SELECT pg_advisory_lock(1)",
      "Side-effecting SQL functions are not allowed: pg_advisory_lock",
      "motherduck"
    );
    await expectValidationError(
      "SELECT GET_LOCK('users', 1)",
      "Side-effecting SQL functions are not allowed: get_lock",
      "mysql"
    );
    await expectValidationError(
      "SHOW TABLES WHERE GET_LOCK('x', 1)",
      "Side-effecting SQL functions are not allowed: get_lock",
      "mysql"
    );
    await expectValidationError(
      "SHOW TABLES WHERE SLEEP(10)",
      "Side-effecting SQL functions are not allowed: sleep",
      "mysql"
    );
    await expectValidationError(
      "DESCRIBE SELECT SLEEP(10)",
      "Side-effecting SQL functions are not allowed: sleep",
      "mysql"
    );
    await expectValidationError(
      "EXPLAIN SELECT GET_LOCK('x', 1)",
      "Side-effecting SQL functions are not allowed: get_lock",
      "mysql"
    );
    await expectValidationError(
      "SELECT @x := 1",
      "Only SELECT, SHOW, DESCRIBE, or EXPLAIN queries are allowed. Got: property_e_q",
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
