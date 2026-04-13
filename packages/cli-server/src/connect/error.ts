import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { CLI_PROBLEM_CATALOG } from "../domain/problems";
import type {
  CliApiErrorStage,
  CliConnectCode,
  CliProblemCatalogEntry,
  CliProblemKey,
} from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";
import {
  BadRequestSchema,
  ErrorInfoSchema,
  RetryInfoSchema,
} from "./gen/google/rpc/error_details_pb";

const CLI_CONNECT_ERROR_DOMAIN = "onequery.cli";
const CLI_ERROR_INFO_CODE_METADATA_KEY = "code";
const CLI_ERROR_INFO_HINT_METADATA_KEY = "hint";
const CLI_ERROR_INFO_REQUEST_ID_METADATA_KEY = "requestId";
const CLI_ERROR_INFO_RETRYABLE_METADATA_KEY = "retryable";
const CLI_ERROR_INFO_STAGE_METADATA_KEY = "stage";
const CLI_ERROR_INFO_TITLE_METADATA_KEY = "title";

type CliConnectValidationIssue = {
  field: string;
  message: string;
  code: string;
};

type CreateCliConnectErrorInput = {
  key: CliProblemKey;
  detail?: string;
  retryAfterMs?: number;
  cause?: unknown;
  stage?: CliApiErrorStage;
  hint?: string;
  errors?: CliConnectValidationIssue[];
};

function toCliConnectCode(code: CliConnectCode): Code {
  switch (code) {
    case "already_exists":
      return Code.AlreadyExists;
    case "deadline_exceeded":
      return Code.DeadlineExceeded;
    case "failed_precondition":
      return Code.FailedPrecondition;
    case "internal":
      return Code.Internal;
    case "invalid_argument":
      return Code.InvalidArgument;
    case "not_found":
      return Code.NotFound;
    case "permission_denied":
      return Code.PermissionDenied;
    case "resource_exhausted":
      return Code.ResourceExhausted;
    case "unauthenticated":
      return Code.Unauthenticated;
    case "unavailable":
      return Code.Unavailable;
  }
}

function requireCliProblemStage(input: {
  key: CliProblemKey;
  stage?: CliApiErrorStage;
}) {
  const problem: CliProblemCatalogEntry = CLI_PROBLEM_CATALOG[input.key];
  const stage = input.stage ?? problem.stage;
  if (!stage) {
    throw new Error(`CLI problem ${input.key} is missing a required stage`);
  }

  return stage;
}

function cliProblemHint(input: { key: CliProblemKey; hint?: string }) {
  const problem: CliProblemCatalogEntry = CLI_PROBLEM_CATALOG[input.key];
  return input.hint ?? problem.hint;
}

function toCliErrorInfoReason(code: string) {
  return code.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function toCliValidationReason(code: string) {
  return code.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function toRetryDelayMessage(retryAfterMs: number) {
  const normalizedRetryAfterMs = Math.max(0, Math.trunc(retryAfterMs));
  return {
    nanos: (normalizedRetryAfterMs % 1000) * 1_000_000,
    seconds: BigInt(Math.trunc(normalizedRetryAfterMs / 1000)),
  } satisfies MessageInitShape<typeof RetryInfoSchema>["retryDelay"];
}

function createCliErrorInfoDetail(input: {
  hint?: string;
  key: CliProblemKey;
  stage: CliApiErrorStage;
}) {
  const problem = CLI_PROBLEM_CATALOG[input.key];
  return {
    desc: ErrorInfoSchema,
    value: {
      domain: CLI_CONNECT_ERROR_DOMAIN,
      metadata: {
        [CLI_ERROR_INFO_CODE_METADATA_KEY]: problem.code,
        ...(input.hint
          ? { [CLI_ERROR_INFO_HINT_METADATA_KEY]: input.hint }
          : {}),
        [CLI_ERROR_INFO_RETRYABLE_METADATA_KEY]: String(problem.retryable),
        [CLI_ERROR_INFO_STAGE_METADATA_KEY]: input.stage,
        [CLI_ERROR_INFO_TITLE_METADATA_KEY]: problem.title,
      },
      reason: toCliErrorInfoReason(problem.code),
    } satisfies MessageInitShape<typeof ErrorInfoSchema>,
  };
}

function createCliBadRequestDetail(errors: CliConnectValidationIssue[]) {
  return {
    desc: BadRequestSchema,
    value: {
      fieldViolations: errors.map((issue) => ({
        description: issue.message,
        field: issue.field,
        reason: toCliValidationReason(issue.code),
      })),
    } satisfies MessageInitShape<typeof BadRequestSchema>,
  };
}

export function createCliConnectError(input: CreateCliConnectErrorInput) {
  const problem: CliProblemCatalogEntry = CLI_PROBLEM_CATALOG[input.key];
  const stage = requireCliProblemStage({
    key: input.key,
    stage: input.stage,
  });
  const hint = cliProblemHint({
    hint: input.hint,
    key: input.key,
  });
  const details: NonNullable<ConstructorParameters<typeof ConnectError>[3]> = [
    createCliErrorInfoDetail({ hint, key: input.key, stage }),
  ];

  if (typeof input.retryAfterMs === "number") {
    details.push({
      desc: RetryInfoSchema,
      value: {
        retryDelay: toRetryDelayMessage(input.retryAfterMs),
      } satisfies MessageInitShape<typeof RetryInfoSchema>,
    });
  }

  if (input.errors && input.errors.length > 0) {
    details.push(createCliBadRequestDetail(input.errors));
  }

  return new ConnectError(
    input.detail ?? problem.title,
    toCliConnectCode(problem.connectCode),
    undefined,
    details,
    input.cause
  );
}

export function throwCliConnectError(input: CreateCliConnectErrorInput): never {
  throw createCliConnectError(input);
}

export function withCliRequestId(error: ConnectError, requestId: string) {
  error.metadata.set(CLI_REQUEST_ID_HEADER, requestId);

  for (const detail of error.details) {
    if (!("desc" in detail) || detail.desc !== ErrorInfoSchema) {
      continue;
    }

    const value = detail.value as MessageInitShape<typeof ErrorInfoSchema>;
    detail.value = {
      ...value,
      metadata: {
        ...(value.metadata ?? {}),
        [CLI_ERROR_INFO_REQUEST_ID_METADATA_KEY]: requestId,
      },
    };
    break;
  }

  return error;
}
