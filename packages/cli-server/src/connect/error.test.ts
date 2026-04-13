import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CLI_PROBLEM_CATALOG } from "../domain/problems";
import type { CliProblemKey } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";
import {
  CLI_RETRY_AFTER_MS_METADATA,
  createCliConnectError,
  withCliRequestId,
} from "./error";

describe("connect error helpers", () => {
  it("projects every canonical CLI problem into a Connect code and title", () => {
    const codeByStatus = new Map([
      [400, Code.InvalidArgument],
      [401, Code.Unauthenticated],
      [403, Code.PermissionDenied],
      [404, Code.NotFound],
      [409, Code.AlreadyExists],
      [410, Code.FailedPrecondition],
      [422, Code.InvalidArgument],
      [429, Code.ResourceExhausted],
      [500, Code.Internal],
      [503, Code.Unavailable],
      [504, Code.DeadlineExceeded],
    ] as const);

    for (const [key, problem] of Object.entries(CLI_PROBLEM_CATALOG)) {
      const error = createCliConnectError({
        key: key as CliProblemKey,
      });

      expect(error.code).toBe(codeByStatus.get(problem.status));
      expect(error.rawMessage).toBe(problem.title);
    }
  });

  it("keeps only request ID and retry delay metadata on the wire", () => {
    const error = createCliConnectError({
      key: "LOGIN_RATE_LIMITED",
      retryAfterMs: 1500,
    });

    withCliRequestId(error, "req_cli_123");

    expect(error.code).toBe(Code.ResourceExhausted);
    expect(error.metadata.get(CLI_REQUEST_ID_HEADER)).toBe("req_cli_123");
    expect(error.metadata.get(CLI_RETRY_AFTER_MS_METADATA)).toBe("1500");
    expect([...error.metadata.keys()].toSorted()).toEqual(
      [CLI_REQUEST_ID_HEADER, CLI_RETRY_AFTER_MS_METADATA].toSorted()
    );
  });
});
