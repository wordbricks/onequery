import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { TaggedError } from "better-result";

import {
  CLI_PROBLEM_CATALOG,
  createCliUserActionableSupport,
} from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";
import {
  BadRequestSchema,
  RetryInfoSchema,
} from "./gen/google/rpc/error_details_pb";
import {
  CliErrorDetailSchema,
  ProblemCode,
  ProblemStage,
  SupportActionKind,
} from "./gen/onequery/cli/v1/common_pb";

type CliProblemKey = keyof typeof CLI_PROBLEM_CATALOG;
type CliProblemCatalogEntry = (typeof CLI_PROBLEM_CATALOG)[CliProblemKey];
type CliConnectCode = CliProblemCatalogEntry["connectCode"];
type CliProblemSupport = CliProblemCatalogEntry["support"];

export type CliConnectValidationIssue = {
  field: string;
  message: string;
  code: string;
};

export type CreateCliConnectErrorInput = {
  key: CliProblemKey;
  detail?: string;
  retryAfterMs?: number;
  cause?: unknown;
  errors?: CliConnectValidationIssue[];
};

export class CliConnectProblem extends TaggedError("CliConnectProblem")<{
  key: CliProblemKey;
  message: string;
  retryAfterMs?: number;
  cause?: unknown;
  errors?: readonly CliConnectValidationIssue[];
}>() {
  constructor(input: CreateCliConnectErrorInput) {
    super({
      key: input.key,
      message: input.detail ?? CLI_PROBLEM_CATALOG[input.key].title,
      ...(typeof input.retryAfterMs === "number"
        ? { retryAfterMs: input.retryAfterMs }
        : {}),
      ...(input.cause !== undefined ? { cause: input.cause } : {}),
      ...(input.errors
        ? {
            errors: input.errors.map((issue) => ({
              code: issue.code,
              field: issue.field,
              message: issue.message,
            })),
          }
        : {}),
    });
  }
}

type CliConnectErrorProblem = Pick<
  CliProblemCatalogEntry,
  "code" | "connectCode" | "hint" | "retryable" | "stage" | "support" | "title"
>;

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

function toSupportActionKind(kind: CliProblemSupport["kind"]) {
  switch (kind) {
    case "none":
      return SupportActionKind.NONE;
    case "retry":
      return SupportActionKind.RETRY;
    case "explain":
      return SupportActionKind.EXPLAIN;
    case "report_if_reproducible":
      return SupportActionKind.REPORT_IF_REPRODUCIBLE;
    case "report_recommended":
      return SupportActionKind.REPORT_RECOMMENDED;
  }
}

function createCliErrorDetail(problem: CliConnectErrorProblem) {
  return {
    desc: CliErrorDetailSchema,
    value: {
      code: problem.code,
      stage: problem.stage,
      title: problem.title,
      ...(problem.hint ? { hint: problem.hint } : {}),
      retryable: problem.retryable,
      support: {
        explainSlug: problem.support.explainSlug,
        kind: toSupportActionKind(problem.support.kind),
        reason: problem.support.reason,
      },
    } satisfies MessageInitShape<typeof CliErrorDetailSchema>,
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

export function createCliConnectProblem(input: CreateCliConnectErrorInput) {
  return new CliConnectProblem(input);
}

export function createCliConnectError(
  input: CreateCliConnectErrorInput | CliConnectProblem
) {
  const problemInput =
    input instanceof CliConnectProblem ? input : createCliConnectProblem(input);
  const problem: CliConnectErrorProblem = CLI_PROBLEM_CATALOG[problemInput.key];
  return createCliConnectErrorFromProblem(problem, {
    cause: problemInput.cause,
    detail: problemInput.message,
    errors: problemInput.errors,
    retryAfterMs: problemInput.retryAfterMs,
  });
}

export function createCliInvalidRequestConnectError(input: {
  cause?: unknown;
  detail?: string;
  errors?: CliConnectValidationIssue[];
  hint: string;
  stage: ProblemStage;
}) {
  return createCliConnectErrorFromProblem(
    {
      code: ProblemCode.INVALID_REQUEST,
      connectCode: "invalid_argument",
      hint: input.hint,
      retryable: false,
      stage: input.stage,
      support: createCliUserActionableSupport(ProblemCode.INVALID_REQUEST),
      title: "Invalid Request",
    },
    input
  );
}

function createCliConnectErrorFromProblem(
  problem: CliConnectErrorProblem,
  input: {
    cause?: unknown;
    detail?: string;
    errors?: readonly CliConnectValidationIssue[];
    retryAfterMs?: number;
  }
) {
  const details: NonNullable<ConstructorParameters<typeof ConnectError>[3]> = [
    createCliErrorDetail(problem),
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
    details.push(createCliBadRequestDetail([...input.errors]));
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
    if (!("desc" in detail) || detail.desc !== CliErrorDetailSchema) {
      continue;
    }

    const value = detail.value as MessageInitShape<typeof CliErrorDetailSchema>;
    detail.value = {
      ...value,
      requestId,
    };
    break;
  }

  return error;
}
