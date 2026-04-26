import type { MessageInitShape } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import { CliFailure, createCliFailure } from "../domain/failures";
import type {
  CreateCliFailureInput,
  CliFailureResource,
  CliValidationIssue,
} from "../domain/failures";
import { CLI_PROBLEM_DEFINITIONS } from "../domain/problems";
import type { CliProblemDefinition } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../request-context";
import {
  BadRequestSchema,
  ErrorInfoSchema,
  ResourceInfoSchema,
  RetryInfoSchema,
} from "./gen/google/rpc/error_details_pb";

export const CLI_ERROR_INFO_DOMAIN = "onequery.cli.v1";

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

function createCliErrorInfoDetail(problem: CliProblemDefinition) {
  return {
    desc: ErrorInfoSchema,
    value: {
      domain: CLI_ERROR_INFO_DOMAIN,
      metadata: {
        problemStage: problem.stage,
        retryable: problem.retryable ? "true" : "false",
      },
      reason: problem.reason,
    } satisfies MessageInitShape<typeof ErrorInfoSchema>,
  };
}

function createCliResourceInfoDetail(resource: CliFailureResource) {
  return {
    desc: ResourceInfoSchema,
    value: {
      resourceName: resource.name,
      resourceType: resource.type,
      ...(resource.description ? { description: resource.description } : {}),
      ...(resource.owner ? { owner: resource.owner } : {}),
    } satisfies MessageInitShape<typeof ResourceInfoSchema>,
  };
}

function createCliBadRequestDetail(errors: CliValidationIssue[]) {
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

export function createCliConnectError(
  input: CreateCliFailureInput | CliFailure
) {
  const failure = input instanceof CliFailure ? input : createCliFailure(input);
  const problem = CLI_PROBLEM_DEFINITIONS[failure.reason];
  return createCliConnectErrorFromProblem(problem, {
    cause: failure.cause,
    detail: failure.message,
    errors: failure.errors,
    resource: failure.resource,
    retryAfterMs: failure.retryAfterMs,
  });
}

function createCliConnectErrorFromProblem(
  problem: CliProblemDefinition,
  input: {
    cause?: unknown;
    detail?: string;
    errors?: readonly CliValidationIssue[];
    resource?: CliFailureResource;
    retryAfterMs?: number;
  }
) {
  const details: NonNullable<ConstructorParameters<typeof ConnectError>[3]> = [
    createCliErrorInfoDetail(problem),
  ];

  if (input.resource) {
    details.push(createCliResourceInfoDetail(input.resource));
  }

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
    input.detail ?? problem.reason,
    problem.connectCode,
    undefined,
    details,
    input.cause
  );
}

export function withCliRequestId(error: ConnectError, requestId: string) {
  error.metadata.set(CLI_REQUEST_ID_HEADER, requestId);
  return error;
}
