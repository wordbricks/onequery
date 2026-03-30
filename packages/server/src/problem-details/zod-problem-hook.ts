import type { Context } from "hono";
import { problemDetails } from "hono-problem-details";

export type ZodProblemHookOptions = {
  title?: string;
  detail?: string;
};

type ValidationError = {
  field: string;
  message: string;
  code: string;
};

type ZodValidationIssue = {
  path: readonly PropertyKey[];
  message: string;
  code?: string;
};

type ZodValidationFailure = {
  issues: readonly ZodValidationIssue[];
};

function formatErrors(
  issues: readonly ZodValidationIssue[]
): ValidationError[] {
  return issues.map((issue) => ({
    code: issue.code ?? "invalid",
    field: issue.path.map((part) => String(part)).join("."),
    message: issue.message,
  }));
}

// NOTE: hono-problem-details/zod currently targets classic ZodError types.
// This repo uses Zod v4 with @hono/zod-validator, so we keep the same response
// shape from README while using a v4-compatible hook signature.
export function zodProblemHook(options?: ZodProblemHookOptions) {
  return (
    result:
      | { success: true; data: unknown }
      | { success: false; error: ZodValidationFailure; data: unknown },
    _c: Context
  ): void => {
    if (result.success) {
      return;
    }

    throw problemDetails({
      detail: options?.detail ?? "Request validation failed",
      extensions: {
        errors: formatErrors(result.error.issues),
      },
      status: 422,
      title: options?.title ?? "Validation Error",
    });
  };
}
