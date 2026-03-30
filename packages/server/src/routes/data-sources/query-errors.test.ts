import { describe, expect, it } from "vitest";

import {
  createCredentialTypeQueryError,
  createPrefixedQueryError,
  createQueryError,
} from "./query-errors";

describe("data source query error helpers", () => {
  it("builds plain query error bodies", () => {
    expect(createQueryError("Invalid payload")).toEqual({
      error: "Invalid payload",
    });
  });

  it("prefixes unknown errors using their message text", () => {
    expect(
      createPrefixedQueryError(
        "Failed to decrypt credentials",
        new Error("ciphertext rejected")
      )
    ).toEqual({
      error: "Failed to decrypt credentials: ciphertext rejected",
    });
  });

  it("formats credential type mismatches consistently", () => {
    expect(createCredentialTypeQueryError("GitHub")).toEqual({
      error: "Data source credentials are not GitHub",
    });
  });
});
