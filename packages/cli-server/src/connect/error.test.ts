import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CLI_PROBLEM_CATALOG } from "../domain/problems";
import type {
  CliApiErrorStage,
  CliProblemCatalogEntry,
  CliProblemKey,
} from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";
import { createCliConnectError, withCliRequestId } from "./error";
import {
  BadRequestSchema,
  ErrorInfoSchema,
  RetryInfoSchema,
} from "./gen/google/rpc/error_details_pb";

describe("connect error helpers", () => {
  it("projects every canonical CLI problem into a Connect code and structured error info", () => {
    const codeByConnectCode = new Map([
      ["already_exists", Code.AlreadyExists],
      ["deadline_exceeded", Code.DeadlineExceeded],
      ["failed_precondition", Code.FailedPrecondition],
      ["internal", Code.Internal],
      ["invalid_argument", Code.InvalidArgument],
      ["not_found", Code.NotFound],
      ["permission_denied", Code.PermissionDenied],
      ["resource_exhausted", Code.ResourceExhausted],
      ["unauthenticated", Code.Unauthenticated],
      ["unavailable", Code.Unavailable],
    ] as const);

    for (const [key, problem] of Object.entries(CLI_PROBLEM_CATALOG)) {
      const typedProblem = problem as CliProblemCatalogEntry;
      const stage =
        typedProblem.stage ?? ("execute_query" satisfies CliApiErrorStage);
      const error = createCliConnectError({
        key: key as CliProblemKey,
        stage,
      });

      expect(error.code).toBe(codeByConnectCode.get(typedProblem.connectCode));
      expect(error.rawMessage).toBe(typedProblem.title);
      expect(error.findDetails(ErrorInfoSchema)).toMatchObject([
        {
          domain: "onequery.cli",
          metadata: {
            code: typedProblem.code,
            ...(typedProblem.hint ? { hint: typedProblem.hint } : {}),
            retryable: String(typedProblem.retryable),
            stage,
            title: typedProblem.title,
          },
          reason: typedProblem.code
            .replace(/[^A-Za-z0-9]+/g, "_")
            .toUpperCase(),
        },
      ]);
    }
  });

  it("keeps request IDs in transport metadata and attaches retry info as a Connect detail", () => {
    const error = createCliConnectError({
      key: "LOGIN_RATE_LIMITED",
      retryAfterMs: 1500,
    });

    withCliRequestId(error, "req_cli_123");

    expect(error.code).toBe(Code.ResourceExhausted);
    expect(error.metadata.get(CLI_REQUEST_ID_HEADER)).toBe("req_cli_123");
    expect([...error.metadata.keys()]).toEqual([CLI_REQUEST_ID_HEADER]);
    expect(error.findDetails(ErrorInfoSchema)).toMatchObject([
      {
        domain: "onequery.cli",
        metadata: {
          code: "login_rate_limited",
          hint: "wait briefly, then retry `onequery auth login`",
          requestId: "req_cli_123",
          retryable: "true",
          stage: "auth",
          title: "Login Rate Limited",
        },
        reason: "LOGIN_RATE_LIMITED",
      },
    ]);
    expect(error.findDetails(RetryInfoSchema)).toMatchObject([
      {
        retryDelay: {
          nanos: 500_000_000,
          seconds: 1n,
        },
      },
    ]);
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
      key: "INVALID_REQUEST",
      stage: "resolve_source",
    });

    expect(error.findDetails(BadRequestSchema)).toMatchObject([
      {
        fieldViolations: [
          {
            description: "must be a hostname",
            field: "credentials.host",
            reason: "INVALID_STRING",
          },
          {
            description: "must be at least 1",
            field: "credentials.port",
            reason: "TOO_SMALL",
          },
        ],
      },
    ]);
  });
});
