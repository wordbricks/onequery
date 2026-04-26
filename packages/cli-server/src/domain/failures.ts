import { TaggedError } from "better-result";

import type { CliProblemKey } from "./problems";

export type CliValidationIssue = {
  field: string;
  message: string;
  code: string;
};

export type CliFailureResource = {
  type: string;
  name: string;
  owner?: string;
  description?: string;
};

export type CreateCliFailureInput = {
  key: CliProblemKey;
  detail?: string;
  retryAfterMs?: number;
  cause?: unknown;
  errors?: CliValidationIssue[];
  resource?: CliFailureResource;
};

export class CliFailure extends TaggedError("CliFailure")<{
  reason: CliProblemKey;
  message: string;
  retryAfterMs?: number;
  cause?: unknown;
  errors?: readonly CliValidationIssue[];
  resource?: CliFailureResource;
}>() {
  constructor(input: CreateCliFailureInput) {
    super({
      reason: input.key,
      message: input.detail ?? input.key,
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
      ...(input.resource ? { resource: input.resource } : {}),
    });
  }
}

export function createCliFailure(input: CreateCliFailureInput) {
  return new CliFailure(input);
}

export function isCliFailure(error: unknown): error is CliFailure {
  return error instanceof CliFailure;
}
