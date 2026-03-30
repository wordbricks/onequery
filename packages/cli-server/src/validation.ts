import type { ValidationTargets } from "hono";

import type { CliApiErrorStage } from "./domain/problems";
import { throwCliProblem } from "./error";

export type CliValidationHookConfig = {
  defaultStage: CliApiErrorStage;
  fieldStages?: Partial<Record<string, CliApiErrorStage>>;
  hint: string;
  defaultMessage?: string;
};

type CliValidationFailure = {
  success: false;
  target: keyof ValidationTargets;
  data: unknown;
  error: {
    issues: readonly {
      path: ReadonlyArray<PropertyKey>;
      message: string;
      code?: string;
    }[];
  };
};

type CliValidationResult =
  | {
      success: true;
      target: keyof ValidationTargets;
      data: unknown;
    }
  | CliValidationFailure;

function getValidationIssueField(
  path: readonly PropertyKey[] | undefined
): string | null {
  const [first] = path ?? [];
  return typeof first === "string" ? first : null;
}

function formatCliValidationIssues(input: CliValidationFailure["error"]) {
  return input.issues.map((issue) => ({
    code: issue.code ?? "invalid",
    field: issue.path.map((part) => String(part)).join("."),
    message: issue.message,
  }));
}

export function throwCliValidationProblem(input: {
  result: CliValidationFailure;
  config: CliValidationHookConfig;
}): never {
  const issue = input.result.error.issues[0];
  const field = getValidationIssueField(issue?.path);

  throwCliProblem({
    detail:
      issue?.message ??
      input.config.defaultMessage ??
      `invalid ${input.result.target} request`,
    errors: formatCliValidationIssues(input.result.error),
    hint: input.config.hint,
    key: "INVALID_REQUEST",
    stage: field
      ? (input.config.fieldStages?.[field] ?? input.config.defaultStage)
      : input.config.defaultStage,
  });
}

export function createCliValidationHook(config: CliValidationHookConfig) {
  return (result: CliValidationResult, _c: unknown): undefined => {
    if (result.success) {
      return undefined;
    }

    throwCliValidationProblem({
      config,
      result,
    });
  };
}
