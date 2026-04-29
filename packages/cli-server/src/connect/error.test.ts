import { Code, ConnectError } from "@connectrpc/connect";
import {
  BadRequestSchema,
  ErrorInfoSchema,
  ResourceInfoSchema,
  RetryInfoSchema,
} from "@onequery/proto-cli/google/rpc/error_details_pb";
import { describe, expect, it } from "vitest";

import { CLI_PROBLEM_DEFINITIONS } from "../domain/problems";
import type { CliProblemDefinition, CliProblemKey } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../request-context";
import { createCliConnectError, withCliRequestId } from "./error";

function summarizeConnectError(error: ConnectError) {
  return {
    badRequest: error.findDetails(BadRequestSchema).map((detail) => ({
      fieldViolations: detail.fieldViolations.map((violation) => ({
        description: violation.description,
        field: violation.field,
        reason: violation.reason,
      })),
    })),
    code: Code[error.code],
    errorInfo: error.findDetails(ErrorInfoSchema).map((detail) => ({
      domain: detail.domain,
      metadata: detail.metadata,
      reason: detail.reason,
    })),
    metadata: Object.fromEntries(error.metadata.entries()),
    rawMessage: error.rawMessage,
    resourceInfo: error.findDetails(ResourceInfoSchema).map((detail) => ({
      description: detail.description,
      owner: detail.owner,
      resourceName: detail.resourceName,
      resourceType: detail.resourceType,
    })),
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
  it("projects every canonical CLI problem into a Connect code and ErrorInfo detail", () => {
    const projectedErrors = Object.fromEntries(
      Object.entries(CLI_PROBLEM_DEFINITIONS).map(([key, problem]) => {
        const typedProblem = problem as CliProblemDefinition;
        const error = createCliConnectError({
          key: key as CliProblemKey,
        });

        expect(error.rawMessage).toBe(typedProblem.reason);

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

  it("serializes resource info as a standard Connect detail", () => {
    const error = createCliConnectError({
      detail: 'no source named "warehouse" exists in org "acme"',
      key: "SOURCE_NOT_FOUND",
      resource: {
        description: "source was not found",
        name: "warehouse",
        owner: "acme",
        type: "onequery.cli.source",
      },
    });

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
