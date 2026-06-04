import type { DatabaseCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { QueryValidationFailure, toErrorMessage } from "./errors";
import type { DatabaseQueryResult, ValidatedSql } from "./types";

export async function validateReadOnlySql(input: {
  provider: DatabaseCredentials["type"];
  sql: string;
}): Promise<DatabaseQueryResult<ValidatedSql>> {
  const validation = await Result.tryPromise({
    try: async () => {
      const { validateAndNormalizeReadOnlyQuery } =
        await import("../validate-sql");
      return validateAndNormalizeReadOnlyQuery(input.sql, input.provider);
    },
    catch: (cause) =>
      new QueryValidationFailure({
        cause,
        message: toErrorMessage(cause),
        provider: input.provider,
      }),
  });

  if (validation.isErr()) {
    return Result.err(validation.error);
  }

  if (validation.value.isErr()) {
    return Result.err(
      new QueryValidationFailure({
        cause: validation.value.error,
        message: validation.value.error.message,
        provider: input.provider,
      })
    );
  }

  return Result.ok(validation.value.value.sql as ValidatedSql);
}
