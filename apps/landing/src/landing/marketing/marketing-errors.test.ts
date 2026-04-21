import { describe, expect, it } from "vitest";

import { readApiErrorMessage } from "./marketing-errors";

describe("readApiErrorMessage", () => {
  it("prefers the first validation field error from typed problem details", () => {
    expect(
      readApiErrorMessage(
        {
          detail: "Request validation failed",
          errors: [
            {
              code: "invalid_format",
              field: "email",
              message: "email must be a valid email address",
            },
          ],
          status: 422,
          title: "Validation Error",
          type: "about:blank",
        },
        "fallback message"
      )
    ).toBe("email must be a valid email address");
  });

  it("falls back to detail for non-validation problem details", () => {
    expect(
      readApiErrorMessage(
        {
          detail: "Landing ingest is not configured",
          status: 503,
          title: "Service Unavailable",
          type: "about:blank",
        },
        "fallback message"
      )
    ).toBe("Landing ingest is not configured");
  });

  it("uses the fallback when detail and title are empty", () => {
    expect(
      readApiErrorMessage(
        {
          detail: "",
          status: 500,
          title: "",
          type: "about:blank",
        },
        "fallback message"
      )
    ).toBe("fallback message");
  });
});
