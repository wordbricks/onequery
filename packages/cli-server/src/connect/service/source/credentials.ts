import type { JsonObject } from "@bufbuild/protobuf";
import {
  getSourceProviderDefinition,
  isSourceProviderId,
} from "@onequery/db/server";
import type { Credentials } from "@onequery/db/server";
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
  if (!isSourceProviderId(provider)) {
    return cliServiceErr({
      detail: "unsupported source provider",
      key: "SOURCE_REQUEST_INVALID",
    });
  }

  if (!credentials) {
    return cliServiceErr({
      detail: "source connect request must include credentials",
      key: "SOURCE_REQUEST_INVALID",
    });
  }

  const definition = getSourceProviderDefinition(provider);
  if (!definition) {
    return cliServiceErr({
      detail: "unsupported source provider",
      key: "SOURCE_REQUEST_INVALID",
    });
  }

  const credentialsWithAuthDefaults =
    (definition.credentialType === "bigquery" ||
      definition.credentialType === "ga") &&
    "serviceAccount" in credentials &&
    !("authType" in credentials)
      ? {
          ...credentials,
          authType: "service_account",
        }
      : credentials;
  const credentialsForValidation =
    provider === "supabase" &&
    definition.credentialType === "postgres" &&
    !("sslMode" in credentialsWithAuthDefaults)
      ? {
          ...credentialsWithAuthDefaults,
          sslMode: "require",
        }
      : credentialsWithAuthDefaults;

  const parsed = definition.credentialSchema.safeParse({
    ...credentialsForValidation,
    type: definition.credentialType,
  });
  if (!parsed.success) {
    return createCliConnectSourceValidationError({
      issues: parsed.error.issues,
    });
  }

  return Result.ok({
    provider,
    credentials: parsed.data as Credentials,
  });
}
