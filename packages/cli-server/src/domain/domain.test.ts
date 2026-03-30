import { describe, expect, it } from "vitest";

import { CLI_PROBLEM_CATALOG } from "./problems";
import { toCliAuthUserView } from "./workflows";

describe("cli domain model", () => {
  it("projects display users into CLI auth user views", () => {
    expect(
      toCliAuthUserView({
        displayName: "Alice",
        email: "alice@example.com",
        id: "user-1",
      })
    ).toEqual({
      displayName: "Alice",
      email: "alice@example.com",
      id: "user-1",
    });
  });

  it("keeps CLI problem metadata in the canonical catalog", () => {
    expect(CLI_PROBLEM_CATALOG.SOURCE_NOT_FOUND).toMatchObject({
      code: "source_not_found",
      hint: "run `onequery source list`",
      stage: "resolve_source",
      status: 404,
      title: "Source Not Found",
      type: "https://onequery.invalid/problems/cli/source-not-found",
    });
    expect("stage" in CLI_PROBLEM_CATALOG.INVALID_REQUEST).toBe(false);
    expect("hint" in CLI_PROBLEM_CATALOG.INVALID_REQUEST).toBe(false);
  });
});
