import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  CLI_PROBLEM_CATALOG,
  cliProblemCodeToString,
  cliProblemStageToString,
  cliSupportActionKindToString,
} from "../domain/problems";
import type { CliProblemCatalogEntry, CliProblemKey } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";
import { createCliConnectError, withCliRequestId } from "./error";
import {
  BadRequestSchema,
  RetryInfoSchema,
} from "./gen/google/rpc/error_details_pb";
import { CliErrorDetailSchema } from "./gen/onequery/cli/v1/common_pb";

function summarizeConnectError(error: ConnectError) {
  return {
    badRequest: error.findDetails(BadRequestSchema).map((detail) => ({
      fieldViolations: detail.fieldViolations.map((violation) => ({
        description: violation.description,
        field: violation.field,
        reason: violation.reason,
      })),
    })),
    cliDetails: error.findDetails(CliErrorDetailSchema).map((detail) => ({
      code: cliProblemCodeToString(detail.code),
      ...(detail.hint ? { hint: detail.hint } : {}),
      ...(detail.requestId ? { requestId: detail.requestId } : {}),
      retryable: detail.retryable,
      stage: cliProblemStageToString(detail.stage),
      support: {
        explainSlug: detail.support.explainSlug,
        kind: cliSupportActionKindToString(detail.support.kind),
        reason: detail.support.reason,
      },
      title: detail.title,
    })),
    code: Code[error.code],
    metadata: Object.fromEntries(error.metadata.entries()),
    rawMessage: error.rawMessage,
    retryInfo: error.findDetails(RetryInfoSchema).map((detail) => ({
      retryDelay: detail.retryDelay
        ? {
            nanos: detail.retryDelay.nanos,
            seconds: detail.retryDelay.seconds.toString(),
          }
        : null,
    })),
  };
}

describe("connect error helpers", () => {
  it("projects every canonical CLI problem into a Connect code and typed CLI error details", () => {
    const projectedErrors = Object.fromEntries(
      Object.entries(CLI_PROBLEM_CATALOG).map(([key, problem]) => {
        const typedProblem = problem as CliProblemCatalogEntry;
        const error = createCliConnectError({
          key: key as CliProblemKey,
        });

        expect(error.rawMessage).toBe(typedProblem.title);

        return [key, summarizeConnectError(error)];
      })
    );

    expect(projectedErrors).toMatchSnapshot();
  });

  it("keeps request IDs in transport metadata and attaches retry info as a Connect detail", () => {
    const error = createCliConnectError({
      key: "LOGIN_RATE_LIMITED",
      retryAfterMs: 1500,
    });

    withCliRequestId(error, "req_cli_123");

    expect(error.metadata.get(CLI_REQUEST_ID_HEADER)).toBe("req_cli_123");
    expect(summarizeConnectError(error)).toMatchSnapshot();
  });

  it("serializes structured validation issues as google.rpc.BadRequest details", () => {
    const error = createCliConnectError({
      detail: "invalid source connect request",
      errors: [
        {
          code: "invalid_string",
          field: "credentials.host",
          message: "must be a hostname",
        },
        {
          code: "too_small",
          field: "credentials.port",
          message: "must be at least 1",
        },
      ],
      key: "SOURCE_REQUEST_INVALID",
    });

    expect(summarizeConnectError(error)).toMatchSnapshot();
  });
});
