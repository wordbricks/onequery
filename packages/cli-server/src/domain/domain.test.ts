import { describe, expect, it } from "vitest";

import { CLI_PROBLEM_DEFINITIONS } from "./problems";
import { toCliAuthUserView } from "./workflows";

describe("cli domain model", () => {
  it("projects display users into CLI auth user views", () => {
    expect(
      toCliAuthUserView({
        displayName: "Alice",
        email: "alice@example.com",
        id: "user-1",
      })
    ).toMatchSnapshot();
  });

  it("keeps CLI problem metadata in the canonical definition table", () => {
    expect({
      notLoggedIn: CLI_PROBLEM_DEFINITIONS.NOT_LOGGED_IN,
      sourceApiExecutionStateInvalid:
        CLI_PROBLEM_DEFINITIONS.SOURCE_API_EXECUTION_STATE_INVALID,
      sourceNotFound: CLI_PROBLEM_DEFINITIONS.SOURCE_NOT_FOUND,
    }).toMatchSnapshot();
    expect(CLI_PROBLEM_DEFINITIONS.AUTH_REQUEST_INVALID.stage).toBeDefined();
    expect(CLI_PROBLEM_DEFINITIONS.SOURCE_REQUEST_INVALID.stage).toBeDefined();
    expect(CLI_PROBLEM_DEFINITIONS.ORG_REQUEST_INVALID.stage).toBeDefined();
    expect(
      CLI_PROBLEM_DEFINITIONS.READ_QUERY_INPUT_INVALID.stage
    ).toBeDefined();
    expect(
      CLI_PROBLEM_DEFINITIONS.EXECUTE_QUERY_REQUEST_INVALID.stage
    ).toBeDefined();
    expect(
      CLI_PROBLEM_DEFINITIONS.SOURCE_API_REQUEST_INVALID.stage
    ).toBeDefined();
  });
});
