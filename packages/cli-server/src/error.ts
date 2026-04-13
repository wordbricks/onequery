import type { Context } from "hono";
import {
  createProblemTypeRegistry,
  problemDetailsHandler,
} from "hono-problem-details";
import { HTTPException } from "hono/http-exception";

import {
  CLI_PROBLEM_CATALOG,
  CLI_PROBLEM_TYPE_PREFIX,
  cliProblemCodeToString,
  cliProblemStageToString,
} from "./domain/problems";
import type { CliProblemKey } from "./domain/problems";

export const CLI_REQUEST_ID_HEADER = "x-request-id";
const CLI_JSON_RESPONSE_CONTENT_TYPE = "application/json; charset=utf-8";

type CliProblemValidationIssue = {
  field: string;
  message: string;
  code: string;
};

const CLI_PROBLEM_REGISTRY = createProblemTypeRegistry(CLI_PROBLEM_CATALOG);

function buildCliProblemExtensions(input: {
  key: CliProblemKey;
  hint?: string;
  errors?: CliProblemValidationIssue[];
  retryAfterMs?: number;
}) {
  const metadata = CLI_PROBLEM_CATALOG[input.key];
  const hint = input.hint ?? metadata.hint;

  return {
    code: cliProblemCodeToString(metadata.code),
    stage: cliProblemStageToString(metadata.stage),
    ...(hint ? { hint } : {}),
    retryable: metadata.retryable,
    ...(typeof input.retryAfterMs === "number"
      ? { retryAfterMs: input.retryAfterMs }
      : {}),
    ...(input.errors && input.errors.length > 0
      ? { errors: input.errors }
      : {}),
  };
}

export function createCliProblem(input: {
  key: CliProblemKey;
  detail?: string;
  instance?: string;
  hint?: string;
  errors?: CliProblemValidationIssue[];
  retryAfterMs?: number;
}) {
  return CLI_PROBLEM_REGISTRY.create(input.key, {
    detail: input.detail,
    extensions: buildCliProblemExtensions(input),
    instance: input.instance,
  });
}

export function throwCliProblem(input: {
  key: CliProblemKey;
  detail?: string;
  instance?: string;
  hint?: string;
  errors?: CliProblemValidationIssue[];
  retryAfterMs?: number;
}): never {
  throw createCliProblem(input);
}

export function createCliProblemHandler() {
  const handler = problemDetailsHandler({
    localize: (problem, c) => ({
      ...problem,
      extensions: {
        ...problem.extensions,
        requestId: getCliRequestId(c),
      },
    }),
    mapError: (error) => {
      if (
        error instanceof HTTPException &&
        error.status === 400 &&
        error.message === "Malformed JSON in request body"
      ) {
        const malformedJson = CLI_PROBLEM_CATALOG.MALFORMED_JSON;
        return {
          status: malformedJson.status,
          type: malformedJson.type,
          title: malformedJson.title,
          detail: "request body must be valid JSON",
          extensions: buildCliProblemExtensions({
            key: "MALFORMED_JSON",
          }),
        };
      }

      return undefined;
    },
    typePrefix: CLI_PROBLEM_TYPE_PREFIX,
  });

  return async (error: Error, c: Context) => {
    const response = await handler(error, c);
    response.headers.set("content-type", CLI_JSON_RESPONSE_CONTENT_TYPE);
    response.headers.set(CLI_REQUEST_ID_HEADER, getCliRequestId(c));
    return response;
  };
}

export function getCliRequestId(c: Context) {
  const requestId = c.get("requestId");
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : "unknown";
}
