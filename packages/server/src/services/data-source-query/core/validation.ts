import type { DatabaseCredentials } from "@onequery/db/server";

import { DataSourceQueryExecutionError } from "./errors";
import type { ValidatedSql } from "./types";

export async function validateReadOnlySql(input: {
  provider: DatabaseCredentials["type"];
  sql: string;
}): Promise<ValidatedSql> {
  const { validateAndNormalizeReadOnlyQuery } = await import("../validate-sql");
  const validation = await validateAndNormalizeReadOnlyQuery(
    input.sql,
    input.provider
  );
  if (validation.isErr()) {
    throw new DataSourceQueryExecutionError(validation.error.message, {
      retryable: false,
      timedOut: false,
    });
  }

  return validation.value.sql as ValidatedSql;
}
