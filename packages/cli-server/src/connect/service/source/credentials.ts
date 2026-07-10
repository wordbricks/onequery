import type { JsonObject } from "@bufbuild/protobuf";
import { safeParseSourceProviderCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { cliServiceErr } from "../result";
import type { CliServiceResult } from "../result";
import type { ParsedConnectSourceCredentials } from "./types";

export function createCliConnectSourceValidationError(input: {
  issues: readonly {
    code: string;
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }[];
}): CliServiceResult<never> {
  const issue = input.issues[0];

  return cliServiceErr({
    detail: issue?.message ?? "invalid source connect request",
    errors: input.issues.map((validationIssue) => ({
      code: validationIssue.code,
      field: validationIssue.path.map((segment) => String(segment)).join("."),
      message: validationIssue.message,
    })),
    key: "SOURCE_REQUEST_INVALID",
  });
}

export function parseConnectSourceCredentials(
  provider: string,
  credentials: JsonObject | undefined
): CliServiceResult<ParsedConnectSourceCredentials> {
  if (!credentials) {
    return cliServiceErr({
      detail: "source connect request must include credentials",
      key: "SOURCE_REQUEST_INVALID",
    });
  }

  const parsed = safeParseSourceProviderCredentials({
    credentials,
    provider,
  });
  if (parsed.success) {
    return Result.ok(parsed.data);
  }

  if (parsed.error.code === "unsupported_provider") {
    return cliServiceErr({
      detail: "unsupported source provider",
      key: "SOURCE_REQUEST_INVALID",
    });
  }

  if (parsed.error.code === "invalid_credentials") {
    return createCliConnectSourceValidationError({
      issues: parsed.error.error.issues,
    });
  }

  return cliServiceErr({
    detail: `source provider '${parsed.error.provider}' does not match credential type '${parsed.error.credentialsType}'`,
    key: "SOURCE_REQUEST_INVALID",
  });
}
