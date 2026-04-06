import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CLI_REQUEST_ID_HEADER } from "../error";
import {
  CLI_RETRY_AFTER_MS_METADATA,
  createCliConnectError,
  withCliRequestId,
} from "./error";

describe("connect error helpers", () => {
  it("maps problem keys to native Connect codes without legacy metadata", () => {
    const error = createCliConnectError({
      key: "NOT_LOGGED_IN",
    });

    expect(error.code).toBe(Code.Unauthenticated);
    expect(error.message).toContain("Not logged in");
    expect([...error.metadata.keys()]).toEqual([]);
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
