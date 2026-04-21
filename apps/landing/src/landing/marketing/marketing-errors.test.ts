import { describe, expect, it } from "vitest";

import { readApiErrorMessage } from "./marketing-errors";

describe("readApiErrorMessage", () => {
  it("falls back to the top-level error message for non-validation errors", () => {
    expect(
      readApiErrorMessage(
        {
          status: 503,
          body: {
            code: "service_unavailable",
            message: "Landing ingest is not configured",
          },
        },
        "fallback message"
      )
    ).toBe("Landing ingest is not configured");
  });

  it("uses the fallback when the error message is empty", () => {
    expect(
      readApiErrorMessage(
        {
          status: 500,
          body: {
            code: "internal_error",
            message: "",
          },
        },
        "fallback message"
      )
    ).toBe("fallback message");
  });
});
